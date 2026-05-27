// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {DarkPoolDEX} from "src/DarkPoolDEX.sol";

abstract contract Base is Test {
    DarkPoolDEX  internal dex;
    address internal admin   = address(0xA1);
    address internal matcher = address(0xB1);
    address internal fee     = address(0xF1);

    function setUp() public virtual {
        vm.prank(admin);
        dex = new DarkPoolDEX(admin, matcher, fee);
    }
}
