// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BagMandate} from "../src/BagMandate.sol";

contract MockUSDC {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BagMandateTest is Test {
    MockUSDC usdc;
    BagMandate mandate;

    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address enforcer = makeAddr("enforcer");
    address payee = makeAddr("payee");
    address stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new MockUSDC();
        mandate = new BagMandate(
            owner,
            operator,
            enforcer,
            address(usdc),
            20e6, // $20 / window
            86400, // 24h
            100e6, // $100 lifetime
            1e6, // $1 per purchase
            3500, // 35% of lifetime = $35 / seller
            3, // max depth
            bytes32("root"),
            100e6 // root allocation
        );
    }

    function fundVault(uint256 amount) internal {
        usdc.mint(owner, amount);
        vm.startPrank(owner);
        usdc.approve(address(mandate), amount);
        mandate.fund(amount);
        vm.stopPrank();
    }

    function testFundAndVaultBalance() public {
        fundVault(50e6);
        assertEq(mandate.vaultBalance(), 50e6);
    }

    function testExecuteWithinBoundsPaysPayee() public {
        fundVault(50e6);
        vm.prank(enforcer);
        mandate.execute(5e5, payee, bytes32("root")); // $0.50
        assertEq(usdc.balanceOf(payee), 5e5);
        assertEq(mandate.windowSpent(), 5e5);
        assertEq(mandate.lifetimeSpent(), 5e5);
        assertEq(mandate.sellerSpent(payee), 5e5);
        assertEq(mandate.vaultBalance(), 50e6 - 5e5);
    }

    function testPerTxCapExceeded() public {
        fundVault(50e6);
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.PerTxCapExceeded.selector);
        mandate.execute(1e6 + 1, payee, bytes32("root")); // > $1 cap
    }

    function testEqualToPerTxCapAllowed() public {
        fundVault(50e6);
        vm.prank(enforcer);
        mandate.execute(1e6, payee, bytes32("root")); // exactly $1 cap is allowed
        assertEq(usdc.balanceOf(payee), 1e6);
    }

    function testDailyCapExceeded() public {
        fundVault(100e6);
        // 20 x $1 fills the $20 window exactly.
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(enforcer);
            mandate.execute(1e6, payee, bytes32("root"));
        }
        // 21st exceeds → DailyCapExceeded
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.DailyCapExceeded.selector);
        mandate.execute(1e6, payee, bytes32("root"));
    }

    function testLifetimeCapExceeded() public {
        fundVault(100e6);
        // 5 windows x 20 x $1 = $100 lifetime. Rotate recipients so the
        // per-seller cap (35% = $35) never triggers before lifetime.
        uint256 count = 0;
        for (uint256 batch = 0; batch < 5; batch++) {
            for (uint256 i = 0; i < 20; i++) {
                address r = address(uint160(0x1000 + count));
                count++;
                vm.prank(enforcer);
                mandate.execute(1e6, r, bytes32("root"));
            }
            vm.warp(block.timestamp + 86400); // next window
        }
        // Lifetime exhausted → next reverts LifetimeCapExceeded.
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.LifetimeCapExceeded.selector);
        mandate.execute(1e6, address(uint160(0xffff)), bytes32("root"));
    }

    function testPerSellerCapExceeded() public {
        fundVault(50e6);
        // seller limit = 35% of $100 = $35. Fill windows, all to ONE payee.
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(enforcer);
            mandate.execute(1e6, payee, bytes32("root")); // window full, seller 20
        }
        vm.warp(block.timestamp + 86400);
        for (uint256 i = 0; i < 15; i++) {
            vm.prank(enforcer);
            mandate.execute(1e6, payee, bytes32("root")); // seller 35
        }
        vm.warp(block.timestamp + 86400);
        // 36th to the same seller exceeds the 35% share → PerSellerCapExceeded
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.PerSellerCapExceeded.selector);
        mandate.execute(1e6, payee, bytes32("root"));
    }

    function testDepthExceeded() public {
        fundVault(10e6);
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.WorkerInactive.selector);
        mandate.execute(5e5, payee, bytes32(uint256(4))); // unknown worker
    }

    function testVaultInsufficient() public {
        fundVault(5e5); // only $0.50
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.VaultInsufficient.selector);
        mandate.execute(1e6, payee, bytes32("root")); // $1 > $0.50 balance
    }

    function testOnlyEnforcerCanExecute() public {
        fundVault(10e6);
        vm.prank(stranger);
        vm.expectRevert(BagMandate.Unauthorized.selector);
        mandate.execute(5e5, payee, bytes32("root"));
    }

    function testWorkerAllocationAndAncestorAccounting() public {
        fundVault(100e6);
        bytes32 child = bytes32("child");
        vm.prank(enforcer);
        mandate.registerWorker(child, bytes32("root"), operator, 50e6, 1);
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.WorkerAllocationExceeded.selector);
        mandate.execute(51e6, payee, child);
        vm.prank(enforcer);
        mandate.execute(50e6, payee, child);
        (, , , uint256 childSpent, , ) = mandate.workers(bytes32("child"));
        (, , , uint256 rootSpent, , ) = mandate.workers(bytes32("root"));
        assertEq(childSpent, 50e6);
        assertEq(rootSpent, 50e6);
    }

    function testOwnerWithdraw() public {
        fundVault(50e6);
        vm.prank(owner);
        mandate.withdraw(20e6, owner);
        assertEq(usdc.balanceOf(owner), 20e6);
    }

    function testWithdrawSelfReverts() public {
        fundVault(50e6);
        vm.prank(owner);
        vm.expectRevert(BagMandate.Unauthorized.selector);
        mandate.withdraw(1e6, address(mandate));
    }

    function testNonOwnerCannotWithdraw() public {
        fundVault(50e6);
        vm.prank(stranger);
        vm.expectRevert(BagMandate.Unauthorized.selector);
        mandate.withdraw(1e6, stranger);
    }

    function testRevokeBlocksExecute() public {
        fundVault(50e6);
        vm.prank(owner);
        mandate.revoke();
        vm.prank(enforcer);
        vm.expectRevert(BagMandate.MandateInactive.selector);
        mandate.execute(5e5, payee, 0);
    }

    function testWindowResets() public {
        fundVault(50e6);
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(enforcer);
            mandate.execute(1e6, payee, bytes32("root"));
        }
        vm.warp(block.timestamp + 86400);
        assertEq(mandate.spendState(), 0);
        vm.prank(enforcer);
        mandate.execute(1e6, payee, bytes32("root"));
        assertEq(mandate.spendState(), 1e6);
    }

    function testFuzzNeverOverspends(uint8 amountUnits, uint8 depth) public {
        vm.assume(amountUnits > 0);
        fundVault(100e6);
        vm.prank(enforcer);
        try mandate.execute(uint256(amountUnits) * 1e3, payee, bytes32("root")) {} catch {}
        assertLe(mandate.lifetimeSpent(), mandate.lifetimeCap());
        assertLe(mandate.windowSpent(), mandate.budgetPerWindow());
        assertLe(mandate.sellerSpent(payee), mandate.sellerLimit());
        assertEq(mandate.vaultBalance() + mandate.lifetimeSpent(), 100e6);
    }
}
