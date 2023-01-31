//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../libs/BaseRelayRecipient.sol";
import "./venus/ComptrollerInterface.sol";
import "./venus/VBep20Interface.sol";
import "./venus/VBNBInterface.sol";

contract VenusAdapter is OwnableUpgradeable, BaseRelayRecipient {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    ComptrollerInterface public immutable COMPTROLLER;
    VBNBInterface public immutable vBNB;

    address internal constant NATIVE_ASSET = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    uint internal constant NO_ERROR = 0;

    event Mint(address indexed account, address indexed underlying, uint amount, address indexed vToken, uint minted);
    event MintFail(address indexed account, address indexed vToken, uint errCode);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _Comptroller, address _vBNB) {
        _disableInitializers();

        COMPTROLLER = ComptrollerInterface(_Comptroller);
        vBNB = VBNBInterface(_vBNB);
    }

    function initialize(address _biconomy) public initializer {
        __Ownable_init();

        trustedForwarder = _biconomy;

        _approvePool();
    }

    function setBiconomy(address _biconomy) external onlyOwner {
        trustedForwarder = _biconomy;
    }

    function _msgSender() internal override(ContextUpgradeable, BaseRelayRecipient) view returns (address) {
        return BaseRelayRecipient._msgSender();
    }

    function versionRecipient() external pure override returns (string memory) {
        return "1";
    }

    /// @notice If new assets are added into the pool, it needs to be called.
    function approvePool() external onlyOwner {
        _approvePool();
    }

    function _approvePool() internal {
        address[] memory vTokens = COMPTROLLER.getAllMarkets();
        COMPTROLLER.enterMarkets(vTokens);

        for (uint i = 0; i < vTokens.length; i++) {
            VTokenInterface vToken = VTokenInterface(vTokens[i]);
            if (address(vToken) == address(vBNB)) continue;

            VBep20Interface vBep20 = VBep20Interface(address(vToken));
            IERC20Upgradeable underlying = IERC20Upgradeable(vBep20.underlying());
            if (underlying.allowance(address(this), address(vBep20)) == 0) {
                underlying.safeApprove(address(vBep20), type(uint).max);
            }
        }
    }

    function mint(VBep20Interface vBep20, uint mintAmount) public returns (uint) {
        address account = _msgSender();
        IERC20Upgradeable underlying = IERC20Upgradeable(vBep20.underlying());
        underlying.safeTransferFrom(account, address(this), mintAmount);
        uint err = vBep20.mint(mintAmount);
        return _postMint(account, address(underlying), mintAmount, vBep20, err);
    }

    function mintBNB() public payable returns (uint) {
        address account = _msgSender();
        vBNB.mint{value: msg.value}();
        return _postMint(account, NATIVE_ASSET, msg.value, vBNB, NO_ERROR);
    }

    function _postMint(address account, address underlying, uint mintAmount, VTokenInterface vToken, uint err) internal returns (uint) {
        if (err == NO_ERROR) {
            uint minted = vToken.balanceOf(address(this));
            IERC20Upgradeable(address(vToken)).safeTransfer(account, minted);
            emit Mint(account, underlying, mintAmount, address(vToken), minted);
            return minted;
        } else {
            emit MintFail(account, address(vToken), err);
            return 0;
        }
    }

    function redeem(VBep20Interface vBep20, uint redeemTokens) external returns (uint) {
    }

    function repayBorrowBehalf(VBep20Interface vBep20, address borrower, uint repayAmount) external returns (uint) {
    }

    /**
    * @dev transfer ETH to an address, revert if it fails.
    * @param to recipient of the transfer
    * @param value the amount to send
    */
    function _safeTransferETH(address to, uint value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));
        require(success, 'ETH_TRANSFER_FAILED');
    }

    receive() external payable {}
}
