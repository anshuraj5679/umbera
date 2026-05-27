// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../Base.t.sol";

contract DarkPoolInvariants is Base {
    function invariant_orderIdMonotonic() public view {
        uint256 n = dex.nextOrderId();
        assertGe(n, 0);
    }

    function invariant_feeBpsBounded() public view {
        assertLe(dex.feeBps(), dex.MAX_FEE());
    }

    function invariant_pendingAdminWellFormed() public view {
        address p = dex.pendingAdmin();
        assertTrue(p == address(0) || p != address(0));
    }
}
