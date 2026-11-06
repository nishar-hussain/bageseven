// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * BagMandate — the single smart account that is Bagseven's guarantee.
 *
 * It holds the tree's USDC (the "vault" is simply its ERC-20 balance) and
 * enforces every spending cap. There is no Allow/Deny configuration: a payment
 * either fits every bound or the contract REVERTS with a named error. Named
 * errors map 1:1 to refusal records:
 *
 *   MandateInactive       — revoked
 *   PerTxCapExceeded      — amount >= perPurchaseCap
 *   DailyCapExceeded      — rolling window budget exhausted
 *   LifetimeCapExceeded   — lifetimeCap exhausted
 *   PerSellerCapExceeded  — a single recipient received > perSellerPct of lifetimeCap
 *   DepthExceeded         — agent depth > maxDepth
 *   VaultInsufficient     — contract USDC balance too low
 *
 * Roles:
 *   owner     — the connected wallet that created + signed the mandate; withdraws, revokes.
 *   operator  — the agent's hot key (fixed at creation); its EIP-712 spend intents are the
 *               only things that may move funds out (relayed by the backend enforcer).
 *   enforcer  — the backend relayer key that submits execute() after verifying the
 *               operator's signature off-chain.
 */
contract BagMandate {
    address public immutable owner;
    address public immutable operator;
    address public immutable enforcer;
    IERC20Minimal public immutable usdc;

    uint256 public immutable budgetPerWindow;
    uint256 public immutable windowSeconds;
    uint256 public immutable lifetimeCap;
    uint256 public immutable perPurchaseCap;
    uint256 public immutable perSellerPct; // 10000 = 100% of lifetimeCap
    uint8 public immutable maxDepth;

    uint256 public windowOpenedAt;
    uint256 public windowSpent;
    uint256 public lifetimeSpent;
    mapping(address => uint256) public sellerSpent;

    struct Worker {
        address operator;
        bytes32 parent;
        uint256 allocation;
        uint256 spent;
        uint8 depth;
        bool active;
    }

    mapping(bytes32 => Worker) public workers;
    bytes32 public immutable rootWorker;

    bool public revoked;

    error MandateInactive();
    error PerTxCapExceeded();
    error DailyCapExceeded();
    error LifetimeCapExceeded();
    error PerSellerCapExceeded();
    error DepthExceeded();
    error VaultInsufficient();
    error Unauthorized();
    error WorkerInactive();
    error WorkerAllocationExceeded();
    error WorkerAlreadyExists();
    error InvalidWorkerParent();

    event Executed(address indexed recipient, uint256 amount, address indexed agent);
    event Withdrawn(address indexed to, uint256 amount);
    event Revoked();

    constructor(
        address owner_,
        address operator_,
        address enforcer_,
        address usdc_,
        uint256 budgetPerWindow_,
        uint256 windowSeconds_,
        uint256 lifetimeCap_,
        uint256 perPurchaseCap_,
        uint256 perSellerPct_,
        uint8 maxDepth_,
        bytes32 rootWorker_,
        uint256 rootAllocation_
    ) {
        owner = owner_;
        operator = operator_;
        enforcer = enforcer_;
        usdc = IERC20Minimal(usdc_);
        budgetPerWindow = budgetPerWindow_;
        windowSeconds = windowSeconds_;
        lifetimeCap = lifetimeCap_;
        perPurchaseCap = perPurchaseCap_;
        perSellerPct = perSellerPct_;
        maxDepth = maxDepth_;
        rootWorker = rootWorker_;
        windowOpenedAt = block.timestamp;
        workers[rootWorker_] = Worker(operator_, bytes32(0), rootAllocation_, 0, 0, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyEnforcer() {
        if (msg.sender != enforcer) revert Unauthorized();
        _;
    }

    function vaultBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /** Rolling window spend, reset when the window elapses. */
    function spendState() public view returns (uint256 currentWindowSpent) {
        if (revoked) return 0;
        if (block.timestamp - windowOpenedAt >= windowSeconds) return 0;
        return windowSpent;
    }

    function sellerLimit() public view returns (uint256) {
        return (lifetimeCap * perSellerPct) / 10000;
    }

    /** Pure bounds check — the off-chain mirror calls this via eth_call. */
    function check(uint256 amount, address recipient, uint8 depth)
        public
        view
        returns (uint8 code)
    {
        if (revoked) return 1; // MandateInactive
        if (amount > perPurchaseCap) return 2; // PerTxCapExceeded
        uint256 cw = spendState();
        if (cw + amount > budgetPerWindow) return 3; // DailyCapExceeded
        if (lifetimeSpent + amount > lifetimeCap) return 4; // LifetimeCapExceeded
        if (recipient != address(0) && sellerSpent[recipient] + amount > sellerLimit()) {
            return 5; // PerSellerCapExceeded
        }
        if (depth > maxDepth) return 6; // DepthExceeded
        if (amount > vaultBalance()) return 7; // VaultInsufficient
        return 0;
    }

    function checkWorker(uint256 amount, address recipient, bytes32 workerId)
        public
        view
        returns (uint8 code)
    {
        Worker memory worker = workers[workerId];
        if (!worker.active || worker.operator == address(0)) return 8; // WorkerInactive
        code = check(amount, recipient, worker.depth);
        if (code != 0) return code;
        bytes32 current = workerId;
        for (uint8 i = 0; i <= maxDepth; i++) {
            Worker memory node = workers[current];
            if (!node.active) return 8;
            if (node.spent + amount > node.allocation) return 9; // WorkerAllocationExceeded
            if (node.parent == bytes32(0)) break;
            current = node.parent;
        }
        return 0;
    }

    function registerWorker(bytes32 workerId, bytes32 parentId, address operator_, uint256 allocation_, uint8 depth_)
        external
        onlyEnforcer
    {
        if (workers[workerId].operator != address(0)) revert WorkerAlreadyExists();
        Worker memory parent = workers[parentId];
        if (!parent.active || depth_ != parent.depth + 1 || depth_ > maxDepth || allocation_ > parent.allocation - parent.spent) {
            revert InvalidWorkerParent();
        }
        workers[workerId] = Worker(operator_, parentId, allocation_, 0, depth_, true);
    }

    function setWorkerActive(bytes32 workerId, bool active) external onlyOwner {
        if (workers[workerId].operator == address(0)) revert WorkerInactive();
        workers[workerId].active = active;
    }

    /** Anyone may fund the vault (the owner, or the dev faucet). */
    function fund(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
    }

    /**
     * The only way funds leave the vault (besides owner withdrawal). The backend
     * verifies the operator's EIP-712 spend intent off-chain, then calls this as
     * the enforcer. Every cap is re-checked on-chain; any violation reverts with
     * a named error, settling nothing.
     */
    function execute(uint256 amount, address recipient, bytes32 workerId) external onlyEnforcer {
        _execute(amount, recipient, workerId);
    }

    function _execute(uint256 amount, address recipient, bytes32 workerId) internal {
        uint8 code = checkWorker(amount, recipient, workerId);
        if (code != 0) {
            if (code == 1) revert MandateInactive();
            if (code == 2) revert PerTxCapExceeded();
            if (code == 3) revert DailyCapExceeded();
            if (code == 4) revert LifetimeCapExceeded();
            if (code == 5) revert PerSellerCapExceeded();
            if (code == 6) revert DepthExceeded();
            if (code == 7) revert VaultInsufficient();
            if (code == 8) revert WorkerInactive();
            revert WorkerAllocationExceeded();
        }

        bool reset = block.timestamp - windowOpenedAt >= windowSeconds;
        windowSpent = reset ? amount : spendState() + amount;
        if (reset) windowOpenedAt = block.timestamp;
        lifetimeSpent += amount;
        if (recipient != address(0)) sellerSpent[recipient] += amount;
        bytes32 current = workerId;
        for (uint8 i = 0; i <= maxDepth; i++) {
            workers[current].spent += amount;
            if (workers[current].parent == bytes32(0)) break;
            current = workers[current].parent;
        }

        require(usdc.transfer(recipient, amount), "transfer failed");
        emit Executed(recipient, amount, workers[workerId].operator);
    }

    /** Owner can always withdraw available USDC (never blocked by caps). */
    function withdraw(uint256 amount, address to) external onlyOwner {
        if (to == address(this)) revert Unauthorized();
        require(usdc.transfer(to, amount), "transfer failed");
        emit Withdrawn(to, amount);
    }

    /** Recover any token accidentally sent to the account. */
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(this)) revert Unauthorized();
        require(IERC20Minimal(token).transfer(to, amount), "transfer failed");
    }

    /** Dead-man switch: the owner revokes all future agent spending. */
    function revoke() external onlyOwner {
        revoked = true;
        emit Revoked();
    }
}
