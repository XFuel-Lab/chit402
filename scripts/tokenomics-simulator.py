#!/usr/bin/env python3
"""
XFuel Protocol - Ferrari Tokenomics Stress Test Simulator
==========================================================

Simulates Ferrari Hybrid Tokenomics (30/30/25/15) under various stress scenarios:
- Low yield environments (bear market)
- Whale dumps (large XF sell pressure)
- Flash crashes (cascading liquidations)
- Revenue decline (reduced bridge volume)

Author: XFuel Security Team
Date: January 6, 2026
Version: 1.0
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from dataclasses import dataclass
from typing import List, Dict, Tuple
import json
from datetime import datetime, timedelta


# ============================================================================
# CONFIGURATION & CONSTANTS
# ============================================================================

@dataclass
class ProtocolConfig:
    """Protocol configuration parameters"""
    # Ferrari revenue splits (basis points)
    BBB_BPS: int = 3000  # 30% Buyback-Burn-Boost
    LP_BPS: int = 3000   # 30% LP Funding
    VEXF_BPS: int = 2500  # 25% veXF Yields
    TREASURY_BPS: int = 1500  # 15% Treasury
    
    # veXF yield distribution
    VEXF_HOLDER_BPS: int = 7000  # 70% to holders
    VEXF_REVERSE_BURN_BPS: int = 3000  # 30% reverse-burn loop
    
    # BBB allocation
    BBB_BURN_BPS: int = 7000  # 70% burned
    BBB_LP_BPS: int = 3000    # 30% paired to LP
    
    # Initial state
    INITIAL_XF_SUPPLY: float = 100_000_000  # 100M XF
    INITIAL_XF_PRICE: float = 0.10  # $0.10 per XF
    INITIAL_TVL: float = 1_000_000  # $1M TVL
    INITIAL_MONTHLY_REVENUE: float = 50_000  # $50K/month
    
    # veXF parameters
    VEXF_LOCK_RATE: float = 0.40  # 40% of supply locked
    VEXF_AVG_MULTIPLIER: float = 3.5  # Average multiplier (1-4 years + bonuses)
    
    # Market parameters
    BASE_APY_COSMOS: float = 0.35  # 35% base APY for Cosmos LSTs
    SWAP_FEE_BPS: int = 30  # 0.3% swap fee
    BRIDGE_FEE_BPS: int = 50  # 0.5% bridge fee


@dataclass
class SimulationState:
    """Current state of the protocol"""
    month: int
    xf_supply: float
    xf_price: float
    tvl: float
    monthly_revenue: float
    lp_depth: float
    vexf_locked: float
    vexf_total_power: float
    treasury_balance: float
    cumulative_burned: float
    holder_rewards_paid: float


# ============================================================================
# CORE SIMULATION ENGINE
# ============================================================================

class TokenomicsSimulator:
    """Main simulation engine for Ferrari tokenomics"""
    
    def __init__(self, config: ProtocolConfig):
        self.config = config
        self.history: List[SimulationState] = []
        
    def initialize_state(self) -> SimulationState:
        """Initialize protocol state at month 0"""
        vexf_locked = self.config.INITIAL_XF_SUPPLY * self.config.VEXF_LOCK_RATE
        vexf_total_power = vexf_locked * self.config.VEXF_AVG_MULTIPLIER
        
        return SimulationState(
            month=0,
            xf_supply=self.config.INITIAL_XF_SUPPLY,
            xf_price=self.config.INITIAL_XF_PRICE,
            tvl=self.config.INITIAL_TVL,
            monthly_revenue=self.config.INITIAL_MONTHLY_REVENUE,
            lp_depth=self.config.INITIAL_TVL * 0.3,  # 30% of TVL in LPs
            vexf_locked=vexf_locked,
            vexf_total_power=vexf_total_power,
            treasury_balance=0,
            cumulative_burned=0,
            holder_rewards_paid=0
        )
    
    def calculate_revenue_split(self, revenue: float) -> Dict[str, float]:
        """Calculate Ferrari 30/30/25/15 revenue distribution"""
        splits = {
            'bbb': revenue * self.config.BBB_BPS / 10000,
            'lp': revenue * self.config.LP_BPS / 10000,
            'vexf': revenue * self.config.VEXF_BPS / 10000,
            'treasury': revenue * self.config.TREASURY_BPS / 10000
        }
        
        # veXF sub-allocation
        splits['vexf_holders'] = splits['vexf'] * self.config.VEXF_HOLDER_BPS / 10000
        splits['vexf_reverse_burn'] = splits['vexf'] * self.config.VEXF_REVERSE_BURN_BPS / 10000
        
        # BBB sub-allocation
        splits['bbb_burn'] = splits['bbb'] * self.config.BBB_BURN_BPS / 10000
        splits['bbb_lp'] = splits['bbb'] * self.config.BBB_LP_BPS / 10000
        
        return splits
    
    def process_month(self, state: SimulationState, 
                      stress_factors: Dict[str, float] = None) -> SimulationState:
        """
        Process one month of tokenomics
        
        Args:
            state: Current protocol state
            stress_factors: Optional stress test multipliers
                - revenue_multiplier: multiply monthly revenue (e.g., 0.5 for 50% drop)
                - price_multiplier: multiply XF price
                - tvl_multiplier: multiply TVL
                - whale_sell: amount of XF dumped on market
        """
        if stress_factors is None:
            stress_factors = {}
        
        # Apply stress factors
        revenue = state.monthly_revenue * stress_factors.get('revenue_multiplier', 1.0)
        xf_price = state.xf_price * stress_factors.get('price_multiplier', 1.0)
        tvl = state.tvl * stress_factors.get('tvl_multiplier', 1.0)
        
        # Calculate revenue split
        splits = self.calculate_revenue_split(revenue)
        
        # Add reverse-burn to next month's revenue (compounding)
        reverse_burn_boost = splits['vexf_reverse_burn']
        
        # Process BBB (Buyback-Burn-Boost)
        bbb_burn_amount = splits['bbb_burn']
        xf_burned = bbb_burn_amount / xf_price if xf_price > 0 else 0
        new_supply = max(state.xf_supply - xf_burned, 10_000_000)  # Min 10M supply floor
        cumulative_burned = state.cumulative_burned + xf_burned
        
        # BBB LP addition (pairs burned XF value with TFUEL)
        bbb_lp_boost = splits['bbb_lp']
        
        # Process LP Funding
        lp_addition = splits['lp'] + bbb_lp_boost
        new_lp_depth = state.lp_depth + lp_addition
        
        # LP depth affects TVL growth (more liquidity -> more users -> more TVL)
        lp_growth_factor = 1 + (lp_addition / state.lp_depth) * 0.1  # 10% efficiency
        new_tvl = tvl * lp_growth_factor
        
        # Process veXF yields
        holder_rewards = splits['vexf_holders']
        total_holder_rewards = state.holder_rewards_paid + holder_rewards
        
        # Process Treasury
        new_treasury = state.treasury_balance + splits['treasury']
        
        # Calculate next month's base revenue (grows with TVL)
        tvl_growth_rate = (new_tvl - tvl) / tvl if tvl > 0 else 0
        base_revenue_growth = tvl_growth_rate * 0.5  # 50% of TVL growth translates to revenue
        next_month_revenue = revenue * (1 + base_revenue_growth) + reverse_burn_boost
        
        # Price dynamics (simplified model)
        # Burn pressure: reduces supply -> increases price
        burn_pressure = xf_burned / state.xf_supply * 0.5  # 50% efficiency
        # Sell pressure: from whale dumps
        whale_sell = stress_factors.get('whale_sell', 0)
        sell_pressure = whale_sell / state.xf_supply * -0.3 if whale_sell > 0 else 0
        # Net price change
        price_change = burn_pressure + sell_pressure
        new_price = xf_price * (1 + price_change)
        
        # Update veXF metrics (locked amount can change with price)
        # Assumption: 10% of new holders lock, 5% of existing unlock monthly
        new_locks = (new_supply - state.xf_supply) * 0.1 if new_supply > state.xf_supply else 0
        unlocks = state.vexf_locked * 0.05
        new_vexf_locked = max(state.vexf_locked + new_locks - unlocks, 0)
        new_vexf_power = new_vexf_locked * self.config.VEXF_AVG_MULTIPLIER
        
        return SimulationState(
            month=state.month + 1,
            xf_supply=new_supply,
            xf_price=new_price,
            tvl=new_tvl,
            monthly_revenue=next_month_revenue,
            lp_depth=new_lp_depth,
            vexf_locked=new_vexf_locked,
            vexf_total_power=new_vexf_power,
            treasury_balance=new_treasury,
            cumulative_burned=cumulative_burned,
            holder_rewards_paid=total_holder_rewards
        )
    
    def run_simulation(self, months: int, 
                       stress_schedule: Dict[int, Dict[str, float]] = None) -> pd.DataFrame:
        """
        Run full simulation
        
        Args:
            months: Number of months to simulate
            stress_schedule: Dict mapping month -> stress_factors
                Example: {6: {'revenue_multiplier': 0.5}, 12: {'whale_sell': 5000000}}
        """
        if stress_schedule is None:
            stress_schedule = {}
        
        state = self.initialize_state()
        self.history = [state]
        
        for month in range(1, months + 1):
            stress_factors = stress_schedule.get(month, {})
            state = self.process_month(state, stress_factors)
            self.history.append(state)
        
        return self._history_to_dataframe()
    
    def _history_to_dataframe(self) -> pd.DataFrame:
        """Convert simulation history to pandas DataFrame"""
        data = []
        for state in self.history:
            data.append({
                'month': state.month,
                'xf_supply': state.xf_supply,
                'xf_price': state.xf_price,
                'xf_mcap': state.xf_supply * state.xf_price,
                'tvl': state.tvl,
                'monthly_revenue': state.monthly_revenue,
                'lp_depth': state.lp_depth,
                'vexf_locked': state.vexf_locked,
                'vexf_lock_rate': state.vexf_locked / state.xf_supply,
                'vexf_total_power': state.vexf_total_power,
                'treasury_balance': state.treasury_balance,
                'cumulative_burned': state.cumulative_burned,
                'burn_rate': state.cumulative_burned / self.config.INITIAL_XF_SUPPLY,
                'holder_rewards_paid': state.holder_rewards_paid,
                'holder_apy': (state.holder_rewards_paid / (state.vexf_locked * state.xf_price) * 12 
                              if state.vexf_locked > 0 else 0)
            })
        return pd.DataFrame(data)


# ============================================================================
# STRESS TEST SCENARIOS
# ============================================================================

class StressTestScenarios:
    """Pre-configured stress test scenarios"""
    
    @staticmethod
    def baseline() -> Dict[int, Dict[str, float]]:
        """Baseline: No stress, normal growth"""
        return {}
    
    @staticmethod
    def bear_market() -> Dict[int, Dict[str, float]]:
        """Bear Market: Revenue drops 60%, TVL drops 40%, price crashes 70%"""
        return {
            3: {'revenue_multiplier': 0.7, 'tvl_multiplier': 0.9, 'price_multiplier': 0.85},
            6: {'revenue_multiplier': 0.4, 'tvl_multiplier': 0.6, 'price_multiplier': 0.5},
            9: {'revenue_multiplier': 0.4, 'tvl_multiplier': 0.6, 'price_multiplier': 0.3},
            12: {'revenue_multiplier': 0.5, 'tvl_multiplier': 0.7, 'price_multiplier': 0.4}
        }
    
    @staticmethod
    def whale_dump() -> Dict[int, Dict[str, float]]:
        """Whale Dump: Large holder dumps 5% of supply each quarter"""
        return {
            3: {'whale_sell': 5_000_000},  # 5M XF dump
            6: {'whale_sell': 4_500_000},  # 4.5M XF dump
            9: {'whale_sell': 4_000_000},  # 4M XF dump
            12: {'whale_sell': 3_500_000}  # 3.5M XF dump
        }
    
    @staticmethod
    def flash_crash() -> Dict[int, Dict[str, float]]:
        """Flash Crash: Sudden 80% price drop in month 6, slow recovery"""
        return {
            6: {'price_multiplier': 0.2, 'tvl_multiplier': 0.5, 'revenue_multiplier': 0.3},
            7: {'price_multiplier': 1.2, 'tvl_multiplier': 1.1, 'revenue_multiplier': 0.8},
            8: {'price_multiplier': 1.15, 'tvl_multiplier': 1.1, 'revenue_multiplier': 0.9}
        }
    
    @staticmethod
    def low_yield_environment() -> Dict[int, Dict[str, float]]:
        """Low Yields: Cosmos LST yields drop to 10% (vs 35% baseline)"""
        # Lower yields -> less user interest -> lower revenue/TVL
        return {
            i: {'revenue_multiplier': 0.6, 'tvl_multiplier': 0.8}
            for i in range(1, 25)
        }
    
    @staticmethod
    def death_spiral() -> Dict[int, Dict[str, float]]:
        """Death Spiral: Cascading failures (bear + whale + crash)"""
        schedule = {}
        for i in range(1, 25):
            factors = {'revenue_multiplier': 0.4, 'price_multiplier': 0.95, 'tvl_multiplier': 0.9}
            if i % 3 == 0:  # Whale dumps every 3 months
                factors['whale_sell'] = 3_000_000
            schedule[i] = factors
        return schedule


# ============================================================================
# ANALYTICS & REPORTING
# ============================================================================

class SimulationAnalyzer:
    """Analyze and visualize simulation results"""
    
    @staticmethod
    def plot_results(baseline_df: pd.DataFrame, stress_df: pd.DataFrame, 
                     scenario_name: str, output_path: str = None):
        """Generate comprehensive plots comparing baseline vs stress scenario"""
        fig, axes = plt.subplots(3, 2, figsize=(15, 12))
        fig.suptitle(f'Ferrari Tokenomics Stress Test: {scenario_name}', fontsize=16)
        
        # Plot 1: XF Price
        ax = axes[0, 0]
        ax.plot(baseline_df['month'], baseline_df['xf_price'], label='Baseline', linewidth=2)
        ax.plot(stress_df['month'], stress_df['xf_price'], label='Stress', linewidth=2, linestyle='--')
        ax.set_title('XF Price Over Time')
        ax.set_xlabel('Month')
        ax.set_ylabel('Price (USD)')
        ax.legend()
        ax.grid(True, alpha=0.3)
        
        # Plot 2: Market Cap
        ax = axes[0, 1]
        ax.plot(baseline_df['month'], baseline_df['xf_mcap'], label='Baseline', linewidth=2)
        ax.plot(stress_df['month'], stress_df['xf_mcap'], label='Stress', linewidth=2, linestyle='--')
        ax.set_title('Market Cap Over Time')
        ax.set_xlabel('Month')
        ax.set_ylabel('Market Cap (USD)')
        ax.legend()
        ax.grid(True, alpha=0.3)
        
        # Plot 3: TVL
        ax = axes[1, 0]
        ax.plot(baseline_df['month'], baseline_df['tvl'], label='Baseline', linewidth=2)
        ax.plot(stress_df['month'], stress_df['tvl'], label='Stress', linewidth=2, linestyle='--')
        ax.set_title('Total Value Locked (TVL)')
        ax.set_xlabel('Month')
        ax.set_ylabel('TVL (USD)')
        ax.legend()
        ax.grid(True, alpha=0.3)
        
        # Plot 4: Monthly Revenue
        ax = axes[1, 1]
        ax.plot(baseline_df['month'], baseline_df['monthly_revenue'], label='Baseline', linewidth=2)
        ax.plot(stress_df['month'], stress_df['monthly_revenue'], label='Stress', linewidth=2, linestyle='--')
        ax.set_title('Monthly Revenue')
        ax.set_xlabel('Month')
        ax.set_ylabel('Revenue (USD)')
        ax.legend()
        ax.grid(True, alpha=0.3)
        
        # Plot 5: Cumulative Burned
        ax = axes[2, 0]
        ax.plot(baseline_df['month'], baseline_df['burn_rate'] * 100, label='Baseline', linewidth=2)
        ax.plot(stress_df['month'], stress_df['burn_rate'] * 100, label='Stress', linewidth=2, linestyle='--')
        ax.set_title('Cumulative Burn Rate')
        ax.set_xlabel('Month')
        ax.set_ylabel('% of Initial Supply Burned')
        ax.legend()
        ax.grid(True, alpha=0.3)
        
        # Plot 6: veXF Lock Rate
        ax = axes[2, 1]
        ax.plot(baseline_df['month'], baseline_df['vexf_lock_rate'] * 100, label='Baseline', linewidth=2)
        ax.plot(stress_df['month'], stress_df['vexf_lock_rate'] * 100, label='Stress', linewidth=2, linestyle='--')
        ax.set_title('veXF Lock Rate')
        ax.set_xlabel('Month')
        ax.set_ylabel('% of Supply Locked')
        ax.legend()
        ax.grid(True, alpha=0.3)
        
        plt.tight_layout()
        
        if output_path:
            plt.savefig(output_path, dpi=300, bbox_inches='tight')
            print(f"✅ Plot saved to {output_path}")
        else:
            plt.show()
    
    @staticmethod
    def generate_report(baseline_df: pd.DataFrame, stress_df: pd.DataFrame, 
                        scenario_name: str) -> Dict:
        """Generate comprehensive metrics report"""
        report = {
            'scenario': scenario_name,
            'timestamp': datetime.now().isoformat(),
            'baseline_metrics': {
                'final_price': baseline_df.iloc[-1]['xf_price'],
                'final_mcap': baseline_df.iloc[-1]['xf_mcap'],
                'final_tvl': baseline_df.iloc[-1]['tvl'],
                'total_burned': baseline_df.iloc[-1]['cumulative_burned'],
                'burn_rate': baseline_df.iloc[-1]['burn_rate'] * 100,
                'total_holder_rewards': baseline_df.iloc[-1]['holder_rewards_paid'],
                'avg_monthly_revenue': baseline_df['monthly_revenue'].mean(),
                'revenue_growth': (
                    (baseline_df.iloc[-1]['monthly_revenue'] - baseline_df.iloc[0]['monthly_revenue']) 
                    / baseline_df.iloc[0]['monthly_revenue'] * 100
                )
            },
            'stress_metrics': {
                'final_price': stress_df.iloc[-1]['xf_price'],
                'final_mcap': stress_df.iloc[-1]['xf_mcap'],
                'final_tvl': stress_df.iloc[-1]['tvl'],
                'total_burned': stress_df.iloc[-1]['cumulative_burned'],
                'burn_rate': stress_df.iloc[-1]['burn_rate'] * 100,
                'total_holder_rewards': stress_df.iloc[-1]['holder_rewards_paid'],
                'avg_monthly_revenue': stress_df['monthly_revenue'].mean(),
                'revenue_growth': (
                    (stress_df.iloc[-1]['monthly_revenue'] - stress_df.iloc[0]['monthly_revenue']) 
                    / stress_df.iloc[0]['monthly_revenue'] * 100
                )
            }
        }
        
        # Calculate resilience metrics (stress vs baseline)
        report['resilience'] = {
            'price_retention': stress_df.iloc[-1]['xf_price'] / baseline_df.iloc[-1]['xf_price'] * 100,
            'mcap_retention': stress_df.iloc[-1]['xf_mcap'] / baseline_df.iloc[-1]['xf_mcap'] * 100,
            'tvl_retention': stress_df.iloc[-1]['tvl'] / baseline_df.iloc[-1]['tvl'] * 100,
            'revenue_retention': stress_df['monthly_revenue'].mean() / baseline_df['monthly_revenue'].mean() * 100
        }
        
        return report
    
    @staticmethod
    def print_report(report: Dict):
        """Pretty print simulation report"""
        print("\n" + "="*80)
        print(f"FERRARI TOKENOMICS STRESS TEST REPORT: {report['scenario']}")
        print("="*80)
        print(f"Generated: {report['timestamp']}\n")
        
        print("BASELINE SCENARIO (Normal Growth)")
        print("-" * 80)
        baseline = report['baseline_metrics']
        print(f"  Final XF Price:         ${baseline['final_price']:.4f}")
        print(f"  Final Market Cap:       ${baseline['final_mcap']:,.0f}")
        print(f"  Final TVL:              ${baseline['final_tvl']:,.0f}")
        print(f"  Total XF Burned:        {baseline['total_burned']:,.0f} ({baseline['burn_rate']:.2f}%)")
        print(f"  Holder Rewards Paid:    ${baseline['total_holder_rewards']:,.0f}")
        print(f"  Avg Monthly Revenue:    ${baseline['avg_monthly_revenue']:,.0f}")
        print(f"  Revenue Growth:         {baseline['revenue_growth']:.1f}%")
        
        print(f"\nSTRESS SCENARIO ({report['scenario']})")
        print("-" * 80)
        stress = report['stress_metrics']
        print(f"  Final XF Price:         ${stress['final_price']:.4f}")
        print(f"  Final Market Cap:       ${stress['final_mcap']:,.0f}")
        print(f"  Final TVL:              ${stress['final_tvl']:,.0f}")
        print(f"  Total XF Burned:        {stress['total_burned']:,.0f} ({stress['burn_rate']:.2f}%)")
        print(f"  Holder Rewards Paid:    ${stress['total_holder_rewards']:,.0f}")
        print(f"  Avg Monthly Revenue:    ${stress['avg_monthly_revenue']:,.0f}")
        print(f"  Revenue Growth:         {stress['revenue_growth']:.1f}%")
        
        print("\nRESILIENCE METRICS (Stress vs Baseline)")
        print("-" * 80)
        resilience = report['resilience']
        print(f"  Price Retention:        {resilience['price_retention']:.1f}%")
        print(f"  Market Cap Retention:   {resilience['mcap_retention']:.1f}%")
        print(f"  TVL Retention:          {resilience['tvl_retention']:.1f}%")
        print(f"  Revenue Retention:      {resilience['revenue_retention']:.1f}%")
        
        # Color-coded resilience assessment
        avg_resilience = np.mean(list(resilience.values()))
        if avg_resilience >= 80:
            assessment = "✅ EXCELLENT - Model is highly resilient"
        elif avg_resilience >= 60:
            assessment = "⚠️  MODERATE - Some weakness detected"
        else:
            assessment = "🔴 CRITICAL - Significant vulnerability"
        
        print(f"\n  Overall Resilience:     {avg_resilience:.1f}% - {assessment}")
        print("="*80 + "\n")


# ============================================================================
# MAIN EXECUTION
# ============================================================================

def main():
    """Run all stress test scenarios"""
    print("="*80)
    print("XFUEL PROTOCOL - FERRARI TOKENOMICS STRESS TEST SIMULATOR")
    print("="*80)
    print(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # Initialize simulator
    config = ProtocolConfig()
    simulator = TokenomicsSimulator(config)
    analyzer = SimulationAnalyzer()
    
    # Run baseline
    print("Running baseline scenario (24 months)...")
    baseline_df = simulator.run_simulation(24, StressTestScenarios.baseline())
    
    # Define stress scenarios to test
    scenarios = [
        ('Bear Market', StressTestScenarios.bear_market()),
        ('Whale Dump', StressTestScenarios.whale_dump()),
        ('Flash Crash', StressTestScenarios.flash_crash()),
        ('Low Yield Environment', StressTestScenarios.low_yield_environment()),
        ('Death Spiral', StressTestScenarios.death_spiral())
    ]
    
    # Run each stress scenario
    results = []
    for scenario_name, stress_schedule in scenarios:
        print(f"\nRunning stress scenario: {scenario_name}...")
        stress_df = simulator.run_simulation(24, stress_schedule)
        
        # Generate report
        report = analyzer.generate_report(baseline_df, stress_df, scenario_name)
        analyzer.print_report(report)
        results.append(report)
        
        # Generate plot
        plot_path = f"tokenomics_stress_{scenario_name.lower().replace(' ', '_')}.png"
        analyzer.plot_results(baseline_df, stress_df, scenario_name, plot_path)
    
    # Export results to JSON
    output_file = 'tokenomics_stress_test_results.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n✅ Full results exported to {output_file}")
    
    # Export DataFrames to CSV
    baseline_df.to_csv('tokenomics_baseline.csv', index=False)
    print(f"✅ Baseline data exported to tokenomics_baseline.csv")
    
    print(f"\n{'='*80}")
    print("STRESS TEST COMPLETE")
    print(f"End Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*80}\n")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Simulation interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

