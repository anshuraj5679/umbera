// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../Base.t.sol";

contract SubmitOrderFuzz is Base {
    function testFuzz_setFeeRate_bounded(uint256 r) public {
        if (r > dex.MAX_FEE()) {
            vm.prank(admin);
            vm.expectRevert();
            dex.setFeeRate(r);
        } else {
            vm.prank(admin);
            dex.setFeeRate(r);
            assertEq(dex.feeBps(), r);
        }
    }

    function testFuzz_setBatchDuration_bounded(uint256 d) public {
        vm.prank(admin);
        if (d < 60 || d > 3600) {
            vm.expectRevert();
            dex.setBatchDuration(d);
        } else {
            dex.setBatchDuration(d);
            assertEq(dex.batchDuration(), d);
        }
    }
}
