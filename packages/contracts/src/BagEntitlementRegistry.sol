// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Public, queryable record of living Bagseven access on Avalanche C-Chain.
 *
 * The holder is a one-way account subject hash, never an email address. A
 * provider first authorizes its gas/operator wallet, then that wallet can
 * issue, consume, and cancel the provider's grants. The daemon remains the
 * policy decision point for worker and account-session authorization; this
 * contract is the durable access clock and audit surface.
 */
contract BagEntitlementRegistry {
    struct Grant {
        address provider;
        bytes32 holder;
        bytes32 feature;
        uint128 remaining;
        uint64 paidThrough;
        bool renewalEnabled;
        bool enabled;
    }

    mapping(address => mapping(address => bool)) public operators;
    mapping(bytes32 => Grant) public grants;
    mapping(bytes32 => mapping(bytes32 => bool)) public consumptions;
    struct Hold { bytes32 grantId; uint128 amount; uint8 state; }
    mapping(bytes32 => Hold) public holds;
    mapping(bytes32 => mapping(bytes32 => uint128)) public consumptionAmounts;

    error Unauthorized();
    error InvalidGrant();
    error GrantExists();
    error GrantNotLive();
    error InsufficientCredits();
    error ConsumptionExists();

    event OperatorSet(address indexed provider, address indexed operator, bool enabled);
    event GrantIssued(
        bytes32 indexed grantId,
        address indexed provider,
        bytes32 indexed holder,
        bytes32 feature,
        uint128 remaining,
        uint64 paidThrough,
        bool renewalEnabled
    );
    event GrantConsumed(bytes32 indexed grantId, bytes32 indexed consumptionId, uint128 amount, uint128 remaining);
    event RenewalCancelled(bytes32 indexed grantId);
    event GrantDisabled(bytes32 indexed grantId);
    event HoldChanged(bytes32 indexed holdId, bytes32 indexed grantId, uint8 state);

    modifier onlyProviderOperator(address provider) {
        if (msg.sender != provider && !operators[provider][msg.sender]) revert Unauthorized();
        _;
    }

    function setOperator(address operator, bool enabled) external {
        if (operator == address(0)) revert InvalidGrant();
        operators[msg.sender][operator] = enabled;
        emit OperatorSet(msg.sender, operator, enabled);
    }

    function issue(
        bytes32 grantId,
        address provider,
        bytes32 holder,
        bytes32 feature,
        uint128 remaining,
        uint64 paidThrough,
        bool renewalEnabled
    ) external onlyProviderOperator(provider) {
        if (
            grantId == bytes32(0) || holder == bytes32(0) || feature == bytes32(0) || remaining == 0
                || paidThrough <= block.timestamp
        ) revert InvalidGrant();
        if (grants[grantId].provider != address(0)) revert GrantExists();
        grants[grantId] = Grant(provider, holder, feature, remaining, paidThrough, renewalEnabled, true);
        emit GrantIssued(grantId, provider, holder, feature, remaining, paidThrough, renewalEnabled);
    }

    function consume(bytes32 grantId, uint128 amount, bytes32 consumptionId) external {
        Grant storage grant = grants[grantId];
        if (grant.provider == address(0)) revert InvalidGrant();
        if (msg.sender != grant.provider && !operators[grant.provider][msg.sender]) revert Unauthorized();
        if (consumptions[grantId][consumptionId]) {
            if (consumptionAmounts[grantId][consumptionId] != amount) revert ConsumptionExists();
            return;
        }
        if (!grant.enabled || grant.paidThrough <= block.timestamp) revert GrantNotLive();
        if (amount == 0 || amount > grant.remaining) revert InsufficientCredits();
        if (consumptionId == bytes32(0) || consumptions[grantId][consumptionId]) revert ConsumptionExists();
        consumptions[grantId][consumptionId] = true;
        consumptionAmounts[grantId][consumptionId] = amount;
        grant.remaining -= amount;
        emit GrantConsumed(grantId, consumptionId, amount, grant.remaining);
    }

    function hold(bytes32 grantId, uint128 amount, bytes32 holdId) external {
        Grant storage grant = grants[grantId];
        if (msg.sender != grant.provider && !operators[grant.provider][msg.sender]) revert Unauthorized();
        Hold memory prior = holds[holdId];
        if (prior.state != 0) {
            if (prior.grantId != grantId || prior.amount != amount) revert ConsumptionExists();
            return;
        }
        if (!grant.enabled || grant.paidThrough <= block.timestamp) revert GrantNotLive();
        if (amount == 0 || amount > grant.remaining || holdId == bytes32(0)) revert InsufficientCredits();
        grant.remaining -= amount;
        holds[holdId] = Hold(grantId, amount, 1);
        emit HoldChanged(holdId, grantId, 1);
    }

    function finalizeHold(bytes32 holdId, bool release) external {
        Hold storage item = holds[holdId];
        Grant storage grant = grants[item.grantId];
        if (item.state == 0) revert InvalidGrant();
        if (msg.sender != grant.provider && !operators[grant.provider][msg.sender]) revert Unauthorized();
        uint8 target = release ? 3 : 2;
        if (item.state == target) return;
        if (item.state != 1) revert ConsumptionExists();
        item.state = target;
        if (release) grant.remaining += item.amount;
        emit HoldChanged(holdId, item.grantId, target);
    }

    function cancelRenewal(bytes32 grantId) external {
        Grant storage grant = grants[grantId];
        if (grant.provider == address(0)) revert InvalidGrant();
        if (msg.sender != grant.provider && !operators[grant.provider][msg.sender]) revert Unauthorized();
        if (!grant.renewalEnabled) return;
        grant.renewalEnabled = false;
        emit RenewalCancelled(grantId);
    }

    function disable(bytes32 grantId) external {
        Grant storage grant = grants[grantId];
        if (grant.provider == address(0)) revert InvalidGrant();
        if (msg.sender != grant.provider && !operators[grant.provider][msg.sender]) revert Unauthorized();
        grant.enabled = false;
        emit GrantDisabled(grantId);
    }

    function isLive(bytes32 grantId) external view returns (bool) {
        Grant memory grant = grants[grantId];
        return grant.provider != address(0) && grant.enabled && grant.remaining > 0 && grant.paidThrough > block.timestamp;
    }
}
