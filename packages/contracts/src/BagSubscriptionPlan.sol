// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISubscriptionToken {
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Fixed-price wallet-pull subscriptions. The plan has no admin, upgrade or withdrawal path.
/// A keeper can collect only the approved amount, to the fixed merchant, once per period.
contract BagSubscriptionPlan {
    address public token;
    address public merchant;
    address public collector;
    uint256 public amount;
    uint256 public periodSeconds;
    bytes32 public planKey;
    uint256 public constant COLLECTION_WINDOW = 1 days + 5 minutes;
    struct Subscription { address payer; uint256 paidThrough; uint256 payments; bool cancelled; }
    mapping(bytes32 => Subscription) public subscriptions;
    bool private entered;

    error InvalidTerms();
    error SelfPayment();
    error NotDue();
    error Inactive();
    error CollectionWindowClosed();
    error PeriodChanged();
    error OwnerOnly();
    error InsufficientFunds();
    error AllowanceRequired();
    error TransferFailed();
    event Paid(bytes32 indexed subscriptionId, address indexed payer, uint256 indexed period, uint256 paidThrough, uint256 amount);
    event Cancelled(bytes32 indexed subscriptionId, uint256 paidThrough);

    constructor(address token_, address merchant_, address collector_, uint256 amount_, uint256 period_, bytes32 key_) {
        if (token_ == address(0) || merchant_ == address(0) || collector_ == address(0) || amount_ == 0 || period_ < 1 days) revert InvalidTerms();
        token = token_; merchant = merchant_; collector = collector_; amount = amount_; periodSeconds = period_; planKey = key_;
    }
    modifier guarded() { require(!entered, "reentrant"); entered = true; _; entered = false; }
    function subscriptionId(address payer, bytes32 checkoutKey) public pure returns (bytes32) {
        return keccak256(abi.encode(payer, checkoutKey));
    }
    function subscribe(bytes32 checkoutKey, uint256 deadline) external guarded returns (bytes32 id) {
        if (block.timestamp > deadline) revert Inactive();
        id = subscriptionId(msg.sender, checkoutKey);
        if (subscriptions[id].payer != address(0)) revert Inactive();
        uint256 end = block.timestamp + periodSeconds;
        subscriptions[id] = Subscription(msg.sender, end, 1, false);
        collect(msg.sender);
        emit Paid(id, msg.sender, 1, end, amount);
    }
    function charge(bytes32 id, uint256 expectedPaidThrough) external guarded {
        if (msg.sender != collector) revert OwnerOnly();
        Subscription storage sub = subscriptions[id];
        if (sub.payer == address(0) || sub.cancelled) revert Inactive();
        // A delayed/rebroadcast transaction cannot accidentally pay a later period.
        if (sub.paidThrough != expectedPaidThrough) revert PeriodChanged();
        if (block.timestamp < sub.paidThrough) revert NotDue();
        if (block.timestamp > sub.paidThrough + COLLECTION_WINDOW) revert CollectionWindowClosed();
        sub.paidThrough += periodSeconds;
        sub.payments += 1;
        collect(sub.payer);
        emit Paid(id, sub.payer, sub.payments, sub.paidThrough, amount);
    }
    function cancel(bytes32 id) external {
        Subscription storage sub = subscriptions[id];
        if (sub.payer != msg.sender) revert OwnerOnly();
        sub.cancelled = true;
        emit Cancelled(id, sub.paidThrough);
    }
    function collect(address payer) private {
        if (payer == merchant) revert SelfPayment();
        if (ISubscriptionToken(token).balanceOf(payer) < amount) revert InsufficientFunds();
        if (ISubscriptionToken(token).allowance(payer, address(this)) < amount) revert AllowanceRequired();
        (bool ok, bytes memory result) = token.call(abi.encodeCall(ISubscriptionToken.transferFrom, (payer, merchant, amount)));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }
}
