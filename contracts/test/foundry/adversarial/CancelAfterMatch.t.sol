// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../Base.t.sol";

contract CancelAfterMatch is Base {
    function test_cancelNonexistent_reverts() public {
        vm.expectRevert();
        dex.cancelOrder(123);
    }
}
