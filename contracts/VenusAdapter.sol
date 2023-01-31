//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IERC20UpgradeableExt.sol";
import "../libs/BaseRelayRecipient.sol";
import "./venus/ComptrollerInterface.sol";
import "./venus/VBep20Interface.sol";
import "./venus/VBNBInterface.sol";

contract VenusAdapter is OwnableUpgradeable, BaseRelayRecipient {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct TokenData {
        address tokenAddress;
        string symbol;
        uint8 decimals;
        address vTokenAddress;
        string vTokenSymbol;
        uint8 vTokenDecimals;
    }

    ComptrollerInterface public immutable COMPTROLLER;
    VBNBInterface public immutable vBNB;

    address internal constant NATIVE_ASSET = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    uint internal constant NO_ERROR = 0;

    event Supply(address indexed account, address indexed vToken, address indexed underlying, uint amount, uint mintedTokens);
    event SupplyFail(address indexed account, address indexed vToken, uint amount, uint errCode);
    event Withdraw(address indexed account, address indexed vToken, uint redeemTokens, address indexed underlying, uint redeemedAmount);
    event WithdrawFail(address indexed account, address indexed vToken, uint redeemTokens, uint errCode);
    event Repay(address indexed account, address indexed vToken, address indexed underlying, uint amount);
    event RepayFail(address indexed account, address indexed vToken, uint amount, uint errCode);

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

            IERC20Upgradeable underlying = IERC20Upgradeable(VBep20Interface(address(vToken)).underlying());
            if (underlying.allowance(address(this), address(vToken)) == 0) {
                underlying.safeApprove(address(vToken), type(uint).max);
            }
        }
    }

    function getAllReservesTokens() external view returns (TokenData[] memory tokens) {
        address[] memory vTokens = COMPTROLLER.getAllMarkets();
        tokens = new TokenData[](vTokens.length);
        for (uint i = 0; i < vTokens.length; i ++) {
            VTokenInterface vToken = VTokenInterface(vTokens[i]);
            tokens[i].vTokenAddress = address(vToken);
            tokens[i].vTokenSymbol = vToken.symbol();
            tokens[i].vTokenDecimals = vToken.decimals();

            if (address(vToken) == address(vBNB)) {
                tokens[i].tokenAddress = NATIVE_ASSET;
                tokens[i].symbol = "BNB";
                tokens[i].decimals = 18;
            } else {
                IERC20UpgradeableExt underlying = IERC20UpgradeableExt(VBep20Interface(address(vToken)).underlying());
                tokens[i].tokenAddress = address(underlying);
                tokens[i].symbol = underlying.symbol();
                tokens[i].decimals = underlying.decimals();
            }
        }
    }

    /// @notice The user must approve this SC for the underlying asset.
    function supply(VBep20Interface vBep20, uint amount) external {
        address account = _msgSender();
        IERC20Upgradeable underlying = IERC20Upgradeable(vBep20.underlying());
        underlying.safeTransferFrom(account, address(this), amount);
        uint err = vBep20.mint(amount);
        if (err != NO_ERROR) {
            underlying.safeTransfer(account, amount);
        }
        _postSupply(account, address(underlying), amount, vBep20, err);
    }

    function supplyETH() external payable {
        address account = _msgSender();
        vBNB.mint{value: msg.value}();
        _postSupply(account, NATIVE_ASSET, msg.value, vBNB, NO_ERROR);
    }

    function _postSupply(address account, address underlying, uint amount, VTokenInterface vToken, uint err) internal {
        if (err == NO_ERROR) {
            uint mintedTokens = vToken.balanceOf(address(this));
            IERC20Upgradeable(address(vToken)).safeTransfer(account, mintedTokens);
            emit Supply(account, address(vToken), underlying, amount, mintedTokens);
        } else {
            emit SupplyFail(account, address(vToken), amount, err);
        }
    }

    function withdraw(address vToken, uint redeemTokens) public {
        address account = _msgSender();
        uint amountToWithdraw = redeemTokens;
        if (redeemTokens == type(uint).max) {
            amountToWithdraw = VTokenInterface(vToken).balanceOf(account);
        }

        IERC20Upgradeable(vToken).safeTransferFrom(account, address(this), amountToWithdraw);
        uint err = VBep20Interface(vToken).redeem(amountToWithdraw);
        if (err != NO_ERROR) {
            IERC20Upgradeable(vToken).safeTransfer(account, amountToWithdraw);
            emit WithdrawFail(account, vToken, amountToWithdraw, err);
        } else {
            if (vToken == address(vBNB)) {
                uint redeemedAmount = address(this).balance;
                _safeTransferETH(account, redeemedAmount);
                emit Withdraw(account, vToken, amountToWithdraw, NATIVE_ASSET, redeemedAmount);
            } else {
                IERC20Upgradeable underlying = IERC20Upgradeable(VBep20Interface(vToken).underlying());
                uint redeemedAmount = underlying.balanceOf(address(this));
                underlying.safeTransfer(account, redeemedAmount);
                emit Withdraw(account, vToken, amountToWithdraw, address(underlying), redeemedAmount);
            }
        }
    }

    /// @notice The user must approve this SC for the underlying asset.
    function repay(VBep20Interface vBep20, uint amount) public {
        address account = _msgSender();
        uint paybackAmount = amount;
        if (amount == type(uint).max) {
            vBep20.accrueInterest();
            paybackAmount = vBep20.borrowBalanceStored(account);
        }

        IERC20Upgradeable underlying = IERC20Upgradeable(vBep20.underlying());
        underlying.safeTransferFrom(account, address(this), paybackAmount);
        uint err = vBep20.repayBorrowBehalf(account, paybackAmount);

        uint left = underlying.balanceOf(address(this));
        if (left > 0) underlying.safeTransfer(account, left);
        if (err == NO_ERROR) {
            emit Repay(account, address(vBep20), address(underlying), paybackAmount-left);
        } else {
            emit RepayFail(account, address(vBep20), paybackAmount, err);
        }
    }

    function repayETH(uint amount) public payable {
        address account = _msgSender();
        uint paybackAmount = amount;
        if (amount == type(uint).max) {
            vBNB.accrueInterest();
            paybackAmount = vBNB.borrowBalanceStored(account);
        }

        require(msg.value >= paybackAmount, 'msg.value is less than repayment amount');
        vBNB.repayBorrowBehalf{value: paybackAmount}(account);

        uint left = address(this).balance;
        if (left > 0) _safeTransferETH(account, left);
        emit Repay(account, address(vBNB), NATIVE_ASSET, msg.value-left);
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
