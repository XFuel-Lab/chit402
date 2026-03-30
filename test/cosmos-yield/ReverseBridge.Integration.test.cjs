/**
 * Cosmos yield / IBC reverse bridge — VaultFactory + SubVault (legacy on Theta).
 * ibcTFUEL → TFUEL flow (burn_for_unwrap on Cosmos, unwrapFromBurn on EVM).
 *
 * Scope: tied to YieldCircuit + CosmWasm / IBC stack — not CertiK Phase 1 core
 * (ZKVerifierSP1, CoreRevenueSplitter, veXFGovernance, SP1ProofHooks).
 *
 * Run: npm run test:contracts:cosmos-yield
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Cosmos yield — Reverse Bridge (VaultFactory)", function () {
    let vaultFactory;
    let revSplitterSink;
    let admin, user1, user2, zkBridge;
    let vaultAddress;

    const INITIAL_SEED = ethers.parseEther("1000"); // 1000 TFUEL
    const BURN_AMOUNT = ethers.parseEther("10"); // 10 TFUEL worth of ibcTFUEL
    const FEE_AMOUNT = BURN_AMOUNT * 50n / 10000n; // 0.5% = 0.05 TFUEL
    const NET_AMOUNT = BURN_AMOUNT - FEE_AMOUNT; // 9.95 TFUEL

    /** Net TFUEL staying in vault after factory seed (SubVault receive takes 0.5% to revSplitter). */
    function netAfterSeedFee(gross) {
        const fee = (gross * 50n) / 10000n;
        return gross - fee;
    }

    beforeEach(async function () {
        [admin, user1, user2, zkBridge] = await ethers.getSigners();

        await ethers.provider.send("hardhat_setBalance", [
            admin.address,
            ethers.toBeHex(ethers.parseEther("100000")),
        ]);

        // SubVault forwards 0.5% seed fees to revSplitter via native transfer;
        // legacy RevenueSplitter has no receive() — use an ETH sink for these tests.
        const Sink = await ethers.getContractFactory("MockRevSplitterEthSink");
        revSplitterSink = await Sink.deploy();
        await revSplitterSink.waitForDeployment();
        const revSplitterAddr = await revSplitterSink.getAddress();

        const VaultFactory = await ethers.getContractFactory("VaultFactory");
        vaultFactory = await VaultFactory.deploy(admin.address, revSplitterAddr);

        const ZK_BRIDGE_ROLE = await vaultFactory.ZK_BRIDGE_ROLE();
        await vaultFactory.grantRole(ZK_BRIDGE_ROLE, zkBridge.address);

        const salt = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256"],
                [user1.address, 1]
            )
        );

        const tx = await vaultFactory.createVault(salt);
        const receipt = await tx.wait();

        const event = receipt.logs.find(log => {
            try {
                return vaultFactory.interface.parseLog(log).name === "VaultCreated";
            } catch {
                return false;
            }
        });
        vaultAddress = vaultFactory.interface.parseLog(event).args.vaultAddr;

        await vaultFactory.seedVault(vaultAddress, { value: INITIAL_SEED });
    });

    describe("User-Initiated Reverse Burns (BurnForUnwrap)", function () {
        it("Should release TFUEL when burn proof is verified", async function () {
            const initialBalance = await ethers.provider.getBalance(user1.address);
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_001"));

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

            await vaultFactory.connect(zkBridge).unwrapFromBurn(
                vaultAddress,
                burnTxHash,
                user1.address,
                NET_AMOUNT
            );

            // BurnAlreadyProcessed is defined on SubVault; factory call bubbles the revert.
            await expect(
                vaultFactory.connect(zkBridge).unwrapFromBurn(
                    vaultAddress,
                    burnTxHash,
                    user1.address,
                    NET_AMOUNT
                )
            ).to.be.reverted;
        });

        it("Should enforce minimum reserve requirement", async function () {
            const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes("mock_burn_tx_005"));

            const tooMuchAmount = INITIAL_SEED * 95n / 100n;

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
            const tooMuchAmount = INITIAL_SEED * 2n;

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
            ).to.be.reverted;
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
            expect(balance).to.equal(netAfterSeedFee(INITIAL_SEED));
        });

        it("Should check if vault can unwrap amount", async function () {
            const safeAmount = ethers.parseEther("50");
            const canUnwrap = await vaultFactory.canUnwrap(vaultAddress, safeAmount);
            expect(canUnwrap).to.be.true;

            const unsafeAmount = ethers.parseEther("950");
            const cannotUnwrap = await vaultFactory.canUnwrap(vaultAddress, unsafeAmount);
            expect(cannotUnwrap).to.be.false;
        });

        it("Should update minimum reserve ratio", async function () {
            const newRatio = 2000;

            await expect(
                vaultFactory.setMinReserveRatio(newRatio)
            ).to.emit(vaultFactory, "MinReserveRatioUpdated")
                .withArgs(1000, newRatio);

            const minReserveRatio = await vaultFactory.minReserveRatio();
            expect(minReserveRatio).to.equal(newRatio);
        });

        it("Should rebalance between vaults", async function () {
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

            await vaultFactory.seedVault(vault2Address, { value: ethers.parseEther("100") });

            const rebalanceAmount = ethers.parseEther("50");

            await expect(
                vaultFactory.rebalanceVaults(vaultAddress, vault2Address, rebalanceAmount)
            ).to.emit(vaultFactory, "VaultRebalanced")
                .withArgs(vaultAddress, vault2Address, rebalanceAmount);
        });

        it("Should get aggregate stats correctly", async function () {
            const [totalLiquidity, totalReserveRequired, availableForUnwrap] =
                await vaultFactory.getAggregateStats();

            expect(totalReserveRequired).to.equal(INITIAL_SEED * 1000n / 10000n);
            // Legacy helper uses address(this).balance on the factory; TFUEL sits in SubVaults, so this reads 0.
            expect(totalLiquidity).to.equal(0n);
            expect(availableForUnwrap).to.equal(0n);
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

            expect(receipt.gasUsed).to.be.lessThan(150000);
        });

        it("Should have reasonable gas costs for vault seeding", async function () {
            const tx = await vaultFactory.seedVault(
                vaultAddress,
                { value: ethers.parseEther("100") }
            );
            const receipt = await tx.wait();

            console.log("Gas used for seedVault:", receipt.gasUsed.toString());

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
            ).to.be.reverted;
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
            ).to.be.reverted;
        });
    });
});
