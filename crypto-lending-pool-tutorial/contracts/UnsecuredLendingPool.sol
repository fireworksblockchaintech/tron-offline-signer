// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Minimal ERC-20 / TRC-20-shaped interface for a single-asset tutorial pool.
interface ILoanToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title UnsecuredLendingPool
/// @notice Educational single-token lending pool. No borrower collateral is taken.
/// @dev Not audited and not suitable for production or real funds.
contract UnsecuredLendingPool {
    uint256 public constant APR_BPS = 10; // 0.10% simple annual interest
    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant YEAR_SECONDS = 365 days;
    uint256 public constant MIN_TERM = 1 days;
    uint256 public constant MAX_TERM = 365 days;
    uint256 public constant DEFAULT_GRACE_PERIOD = 30 days;
    uint256 public constant MAX_ACTIVE_LOANS = 32;

    enum LoanStatus { None, Active, Repaid, Defaulted }

    struct Loan {
        address borrower;
        uint128 principal;
        uint64 startedAt;
        uint64 maturityAt;
        LoanStatus status;
    }

    ILoanToken public immutable asset;
    address public owner;
    bool public paused;
    uint256 public totalSupply;
    uint256 public nextLoanId = 1;
    uint256 private _lock = 1;

    mapping(address lender => uint256 shares) public sharesOf;
    mapping(uint256 loanId => Loan loan) public loans;
    mapping(address borrower => bool hasActiveLoan) public borrowerHasActiveLoan;
    uint256[] private _activeLoanIds;
    mapping(uint256 loanId => uint256 indexPlusOne) private _activeIndex;

    event Deposited(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event Borrowed(uint256 indexed loanId, address indexed borrower, uint256 principal, uint64 maturityAt);
    event Repaid(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 interest);
    event DefaultRecorded(uint256 indexed loanId, address indexed borrower, uint256 writtenOff);
    event PauseChanged(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "PAUSED");
        _;
    }

    modifier nonReentrant() {
        require(_lock == 1, "REENTRANT_CALL");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "ZERO_TOKEN");
        asset = ILoanToken(tokenAddress);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Total pool value: liquid tokens plus principal and accrued loan interest.
    /// @dev The bounded active-loan count keeps this view's work bounded.
    function totalAssets() public view returns (uint256 assets) {
        assets = asset.balanceOf(address(this));
        for (uint256 i = 0; i < _activeLoanIds.length; ++i) {
            Loan storage loan = loans[_activeLoanIds[i]];
            assets += _debtAt(loan, block.timestamp);
        }
    }

    function activeLoanIds() external view returns (uint256[] memory) {
        return _activeLoanIds;
    }

    function activeLoanCount() external view returns (uint256) {
        return _activeLoanIds.length;
    }

    /// @notice Deposit the pool token and receive non-transferable pool shares.
    function deposit(uint256 amount) external whenNotPaused nonReentrant returns (uint256 shares) {
        require(amount > 0, "ZERO_AMOUNT");
        uint256 assetsBefore = totalAssets();
        if (totalSupply == 0) {
            shares = amount;
        } else {
            require(assetsBefore > 0, "POOL_HAS_NO_ASSETS");
            shares = (amount * totalSupply) / assetsBefore;
        }
        require(shares > 0, "ZERO_SHARES");

        _pullExact(msg.sender, amount);
        sharesOf[msg.sender] += shares;
        totalSupply += shares;
        emit Deposited(msg.sender, amount, shares);
    }

    /// @notice Redeem shares for available liquid tokens. Outstanding loans are not liquid.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        require(shares > 0 && shares <= sharesOf[msg.sender], "INVALID_SHARES");
        require(totalSupply > 0, "NO_SHARES");
        amount = (shares * totalAssets()) / totalSupply;
        require(amount > 0, "ZERO_ASSETS");
        require(asset.balanceOf(address(this)) >= amount, "INSUFFICIENT_LIQUIDITY");

        sharesOf[msg.sender] -= shares;
        totalSupply -= shares;
        _pushExact(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    /// @notice Borrow with no collateral after a same-token wallet-balance qualification check.
    /// @dev Requires an existing balance equal to at least 10% of the requested amount. The
    ///      balance remains in the wallet and may be transferred immediately after this call.
    function borrow(uint256 amount, uint256 termSeconds)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 loanId)
    {
        require(amount > 0 && amount <= type(uint128).max, "INVALID_AMOUNT");
        require(termSeconds >= MIN_TERM && termSeconds <= MAX_TERM, "INVALID_TERM");
        require(_activeLoanIds.length < MAX_ACTIVE_LOANS, "ACTIVE_LOAN_LIMIT");
        require(!borrowerHasActiveLoan[msg.sender], "BORROWER_ALREADY_HAS_ACTIVE_LOAN");
        require(asset.balanceOf(address(this)) >= amount, "INSUFFICIENT_LIQUIDITY");

        uint256 requiredBalance = amount / 10 + (amount % 10 == 0 ? 0 : 1);
        require(asset.balanceOf(msg.sender) >= requiredBalance, "NEED_10_PERCENT_WALLET_BALANCE");

        uint256 maturity = block.timestamp + termSeconds;
        require(maturity <= type(uint64).max, "MATURITY_OVERFLOW");

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            principal: uint128(amount),
            startedAt: uint64(block.timestamp),
            maturityAt: uint64(maturity),
            status: LoanStatus.Active
        });
        borrowerHasActiveLoan[msg.sender] = true;
        _addActive(loanId);
        _pushExact(msg.sender, amount);
        emit Borrowed(loanId, msg.sender, amount, uint64(maturity));
    }

    /// @notice Repay the full loan principal plus simple interest accrued through maturity.
    function repay(uint256 loanId) external nonReentrant returns (uint256 amountDue) {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "LOAN_NOT_ACTIVE");
        require(msg.sender == loan.borrower, "NOT_BORROWER");

        amountDue = _debtAt(loan, block.timestamp);
        uint256 principal = loan.principal;
        uint256 interest = amountDue - principal;

        // Effects before token interaction; any transfer failure reverts these changes.
        loan.status = LoanStatus.Repaid;
        borrowerHasActiveLoan[msg.sender] = false;
        _removeActive(loanId);
        _pullExact(msg.sender, amountDue);
        emit Repaid(loanId, msg.sender, principal, interest);
    }

    /// @notice Write off a loan after maturity plus a fixed 30-day grace period.
    /// @dev Anyone can record the default; this removes the uncollectable loan from pool NAV.
    function recordDefault(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "LOAN_NOT_ACTIVE");
        require(block.timestamp > uint256(loan.maturityAt) + DEFAULT_GRACE_PERIOD, "GRACE_PERIOD_ACTIVE");
        uint256 writtenOff = _debtAt(loan, block.timestamp);
        loan.status = LoanStatus.Defaulted;
        borrowerHasActiveLoan[loan.borrower] = false;
        _removeActive(loanId);
        emit DefaultRecorded(loanId, loan.borrower, writtenOff);
    }

    function pause() external onlyOwner {
        require(!paused, "ALREADY_PAUSED");
        paused = true;
        emit PauseChanged(true);
    }

    function unpause() external onlyOwner {
        require(paused, "NOT_PAUSED");
        paused = false;
        emit PauseChanged(false);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _debtAt(Loan storage loan, uint256 timestamp) private view returns (uint256) {
        uint256 accruedUntil = timestamp < loan.maturityAt ? timestamp : loan.maturityAt;
        uint256 elapsed = accruedUntil - loan.startedAt;
        uint256 interest = (uint256(loan.principal) * APR_BPS * elapsed) / (BASIS_POINTS * YEAR_SECONDS);
        return uint256(loan.principal) + interest;
    }

    function _addActive(uint256 loanId) private {
        _activeLoanIds.push(loanId);
        _activeIndex[loanId] = _activeLoanIds.length;
    }

    function _removeActive(uint256 loanId) private {
        uint256 indexPlusOne = _activeIndex[loanId];
        require(indexPlusOne != 0, "LOAN_INDEX_MISSING");
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _activeLoanIds.length - 1;
        if (index != lastIndex) {
            uint256 movedLoanId = _activeLoanIds[lastIndex];
            _activeLoanIds[index] = movedLoanId;
            _activeIndex[movedLoanId] = index + 1;
        }
        _activeLoanIds.pop();
        delete _activeIndex[loanId];
    }

    function _pullExact(address from, uint256 amount) private {
        uint256 beforeBalance = asset.balanceOf(address(this));
        _callToken(abi.encodeWithSelector(asset.transferFrom.selector, from, address(this), amount));
        require(asset.balanceOf(address(this)) - beforeBalance == amount, "INEXACT_TOKEN_IN");
    }

    function _pushExact(address to, uint256 amount) private {
        uint256 beforeBalance = asset.balanceOf(address(this));
        _callToken(abi.encodeWithSelector(asset.transfer.selector, to, amount));
        require(beforeBalance - asset.balanceOf(address(this)) == amount, "INEXACT_TOKEN_OUT");
    }

    function _callToken(bytes memory callData) private {
        (bool success, bytes memory returnData) = address(asset).call(callData);
        require(success, "TOKEN_CALL_FAILED");
        if (returnData.length > 0) {
            require(abi.decode(returnData, (bool)), "TOKEN_OPERATION_FAILED");
        }
    }
}

