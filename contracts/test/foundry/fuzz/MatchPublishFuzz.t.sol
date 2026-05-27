// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../Base.t.sol";
import {InEuint128} from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

contract MatchPublishFuzz is Base {
    function testFuzz_publishMatches_unauthorized_reverts(address caller) public {
        vm.assume(caller != matcher);
        vm.prank(caller);
        vm.expectRevert();
        uint256[] memory empty = new uint256[](0);
        InEuint128[] memory emptyInputs = new InEuint128[](0);
        dex.publishMatches(empty, empty, emptyInputs, emptyInputs, emptyInputs, emptyInputs);
    }
}
