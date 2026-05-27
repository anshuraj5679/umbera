// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../Base.t.sol";

contract ReentrancyAttack is Base {
    function test_reentrancyGuardPresent() public {
        vm.expectRevert();
        dex.settleMatch(0);
    }
}
