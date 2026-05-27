// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../Base.t.sol";

contract SettleBeforeWindow is Base {
    function test_settleNonexistent_reverts() public {
        vm.expectRevert();
        dex.settleMatch(9999);
    }
}
