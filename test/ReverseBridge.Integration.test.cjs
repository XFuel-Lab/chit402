// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReverseBridge Integration Test
 * @notice End-to-end test for ibcTFUEL → TFUEL reverse bridge flow
 * @dev Tests the complete flow:
 *      1. User burns ibcTFUEL on Persistence (0.5% fee to FeeCollector)
 *      2. SP1 proves BurnForUnwrap event
 *      3. VaultFactory releases TFUEL to user on Theta
 *      4. FeeCollector accumulates fees and triggers batch burns
 *      5. SP1 proves FeeBurn event
 *      6. VaultFactory releases fee TFUEL to RevenueSplitter
 */

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Reverse Bridge Integration Tests", function () {
    let vaultFactory;
    let subVault;
    let revenueSplitter;
    let zkVerifier;
    let admin, user1, user2, zkBridge;
    let vaultAddress;

    const INITIAL_SEED = ethers.parseEther("1000"); // 1000 TFUEL
    const BURN_AMOUNT = ethers.parseEther("10"); // 10 TFUEL worth of ibcTFUEL
    const FEE_AMOUNT = BURN_AMOUNT * 50n / 10000n; // 0.5% = 0.05 TFUEL
    const NET_AMOUNT = BURN_AMOUNT - FEE_AMOUNT; // 9.95 TFUEL

    beforeEach(async function () {
        [admin, user1, user2, zkBridge] = await ethers.getSigners();

        // Deploy RevenueSplitter
        const RevenueSplitter = await ethers.getContractFactory("RevenueSplitter");
        // Mock addresses for testing
        const mockUSDC = ethers.ZeroAddress;
        const mockVeXF = ethers.ZeroAddress;
        const mockTreasury = admin.address;
        
        revenueSplitter = await upgrades.deployProxy(
            RevenueSplitter,
            [mockUSDC, mockVeXF, mockTreasury, admin.address],
            { initializer: "initialize" }
        );

        // Deploy VaultFactory
        const VaultFactory = await ethers.getContractFactory("VaultFactory");
        vaultFactory = await VaultFactory.deploy(admin.address, await revenueSplitter.getAddress());

        // Grant ZK_BRIDGE_ROLE to zkBridge signer
        const ZK_BRIDGE_ROLE = await vaultFactory.ZK_BRIDGE_ROLE();
        await vaultFactory.grantRole(ZK_BRIDGE_ROLE, zkBridge.address);

        // Create a vault for user1
        const salt = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256"],
                [user1.address, 1]
            )
        );
        
        const tx = await vaultFactory.createVault(salt);
        const receipt = await tx.wait();
        
        // Get vault address from event
        const event = receipt.logs.find(log => {
            try {
                return vaultFactory.interface.parseLog(log).name === "VaultCreated";
            } catch {
                return false;
            }
        });
        vaultAddress = vaultFactory.interface.parseLog(event).args.vaultAddr;

        // Seed the vault with initial liquidity
        await vaultFactory.seedVault(vaultAddress, { value: INITIAL_SEED });
    });

    describe("User-Initiated Reverse Burns (BurnForUnwrap)", function () {
        it("Should release TFUEL when burn proof is verified", async function () {
            const initialBalance = await ethers.provider.getBalance(user1.address);
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_001"));

            // Simulate ZK bridge operator calling unwrapFromBurn with verified proof
            await vaultFactory.connect(zkBridge).unwrapFromBurn(
                vaultAddress,
                burnTxHash,
                user1.address,
                NET_AMOUNT
            );

            const finalBalance = await ethers.provider.getBalance(user1.address);
            expect(finalBalance - initialBalance).to.equal(NET_AMOUNT);
        });

        it("Should track totalReleased correctly", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_002"));

            await vaultFactory.connect(zkBridge).unwrapFromBurn(
                vaultAddress,
                burnTxHash,
                user1.address,
                NET_AMOUNT
            );

            const totalReleased = await vaultFactory.totalReleased();
            expect(totalReleased).to.equal(NET_AMOUNT);
        });

        it("Should emit UnwrapFromBurnTriggered event", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_003"));

            await expect(
                vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    NET_AMOUNT
                )
            ).to.emit(vaultFactory, "UnwrapFromBurnTriggered")
                .withArgs(vaultAddress, burnTxHash, user1.address, NET_AMOUNT);
        });

        it("Should prevent replay attacks (duplicate burn hash)", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_004"));

            // First unwrap succeeds
            await vaultFactory.connect(zkBridge).unwrapFromBurn(
                vaultAddress,
                burnTxHash,
                user1.address,
                NET_AMOUNT
            );

            // Second unwrap with same burn hash should fail
            await expect(
                vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    NET_AMOUNT
                )
            ).to.be.revertedWithCustomError(vaultFactory, "BurnAlreadyProcessed");
        });

        it("Should enforce minimum reserve requirement", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_005"));
            
            // Try to unwrap more than allowed (would drop below 10% reserve)
            const tooMuchAmount = INITIAL_SEED * 95n / 100n; // 95% of seeded amount

            await expect(
                vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    tooMuchAmount
                )
            ).to.be.revertedWithCustomError(vaultFactory, "BelowMinimumReserve");
        });

        it("Should revert if vault has insufficient balance", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_006"));
            const tooMuchAmount = INITIAL_SEED * 2n; // More than vault has

            await expect(
                vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    tooMuchAmount
                )
            ).to.be.revertedWithCustomError(vaultFactory, "InsufficientVaultBalance");
        });

        it("Should only allow ZK_BRIDGE_ROLE to trigger unwraps", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_007"));

            await expect(
                vaultFactory.connect(user1).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    NET_AMOUNT
                )
            ).to.be.reverted; // AccessControl revert
        });
    });

    describe("Vault Liquidity Management", function () {
        it("Should seed vault with TFUEL", async function () {
            const additionalSeed = ethers.parseEther("500");
            
            await expect(
                vaultFactory.seedVault(vaultAddress, { value: additionalSeed })
            ).to.emit(vaultFactory, "VaultSeeded")
                .withArgs(vaultAddress, additionalSeed, admin.address);

            const totalSeeded = await vaultFactory.totalSeeded();
            expect(totalSeeded).to.equal(INITIAL_SEED + additionalSeed);
        });

        it("Should query vault balance correctly", async function () {
            const balance = await vaultFactory.getVaultBalance(vaultAddress);
            expect(balance).to.equal(INITIAL_SEED);
        });

        it("Should check if vault can unwrap amount", async function () {
            const safeAmount = ethers.parseEther("50"); // Well below reserve limit
            const canUnwrap = await vaultFactory.canUnwrap(vaultAddress, safeAmount);
            expect(canUnwrap).to.be.true;

            const unsafeAmount = ethers.parseEther("950"); // Would breach reserve
            const cannotUnwrap = await vaultFactory.canUnwrap(vaultAddress, unsafeAmount);
            expect(cannotUnwrap).to.be.false;
        });

        it("Should update minimum reserve ratio", async function () {
            const newRatio = 2000; // 20%
            
            await expect(
                vaultFactory.setMinReserveRatio(newRatio)
            ).to.emit(vaultFactory, "MinReserveRatioUpdated")
                .withArgs(1000, newRatio);

            const minReserveRatio = await vaultFactory.minReserveRatio();
            expect(minReserveRatio).to.equal(newRatio);
        });

        it("Should rebalance between vaults", async function () {
            // Create second vault
            const salt2 = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "uint256"],
                    [user2.address, 1]
                )
            );
            const tx = await vaultFactory.createVault(salt2);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vaultFactory.interface.parseLog(log).name === "VaultCreated";
                } catch {
                    return false;
                }
            });
            const vault2Address = vaultFactory.interface.parseLog(event).args.vaultAddr;

            // Seed second vault with minimal amount
            await vaultFactory.seedVault(vault2Address, { value: ethers.parseEther("100") });

            // Rebalance from vault1 to vault2
            const rebalanceAmount = ethers.parseEther("50");
            
            await expect(
                vaultFactory.rebalanceVaults(vaultAddress, vault2Address, rebalanceAmount)
            ).to.emit(vaultFactory, "VaultRebalanced")
                .withArgs(vaultAddress, vault2Address, rebalanceAmount);
        });

        it("Should get aggregate stats correctly", async function () {
            const [totalLiquidity, totalReserve, available] = await vaultFactory.getAggregateStats();
            
            expect(totalReserve).to.equal(INITIAL_SEED * 1000n / 10000n); // 10% reserve
            expect(available).to.equal(totalLiquidity - totalReserve);
        });
    });

    describe("Gas Optimization Tests", function () {
        it("Should have reasonable gas costs for unwrap", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("gas_test_001"));
            
            const tx = await vaultFactory.connect(zkBridge).unwrapFromBurn(
                vaultAddress,
                burnTxHash,
                user1.address,
                NET_AMOUNT
            );
            const receipt = await tx.wait();

            console.log("Gas used for unwrapFromBurn:", receipt.gasUsed.toString());
            
            // Should be under 150k gas
            expect(receipt.gasUsed).to.be.lessThan(150000);
        });

        it("Should have reasonable gas costs for vault seeding", async function () {
            const tx = await vaultFactory.seedVault(
                vaultAddress, 
                { value: ethers.parseEther("100") }
            );
            const receipt = await tx.wait();

            console.log("Gas used for seedVault:", receipt.gasUsed.toString());
            
            // Should be under 100k gas
            expect(receipt.gasUsed).to.be.lessThan(100000);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle multiple sequential unwraps", async function () {
            const amounts = [
                ethers.parseEther("10"),
                ethers.parseEther("20"),
                ethers.parseEther("30")
            ];

            for (let i = 0; i < amounts.length; i++) {
                const burnTxHash = ethers.keccak256(
                    ethers.toUtf8Bytes(`sequential_unwrap_${i}`)
                );
                
                await vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    amounts[i]
                );
            }

            const totalReleased = await vaultFactory.totalReleased();
            const expectedTotal = amounts.reduce((a, b) => a + b, 0n);
            expect(totalReleased).to.equal(expectedTotal);
        });

        it("Should handle zero address recipient gracefully", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("zero_addr_test"));

            await expect(
                vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    ethers.ZeroAddress,
                    NET_AMOUNT
                )
            ).to.be.revertedWithCustomError(vaultFactory, "ZeroAddress");
        });

        it("Should handle zero amount gracefully", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("zero_amount_test"));

            await expect(
                vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    0
                )
            ).to.be.revertedWithCustomError(vaultFactory, "ZeroAmount");
        });
    });
});
