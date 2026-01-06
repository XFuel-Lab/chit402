#!/usr/bin/env python3
"""
XFuel Protocol - Ferrari Tokenomics Stress Test Simulator (Simplified)
========================================================================

NO DEPENDENCIES VERSION - Uses only Python standard library
Simulates Ferrari Hybrid Tokenomics (30/30/25/15) under stress scenarios

Author: XFuel Security Team
Date: January 6, 2026
Version: 1.0 (Simplified)
"""

import json
import math
from datetime import datetime


# ============================================================================
# CONFIGURATION
# ============================================================================

class Config:
    # Ferrari revenue splits (basis points)
    BBB_BPS = 3000  # 30%
    LP_BPS = 3000   # 30%
    VEXF_BPS = 2500 # 25%
    TREASURY_BPS = 1500 # 15%
    
    # veXF distribution
    VEXF_HOLDER_BPS = 7000  # 70% to holders
    VEXF_REVERSE_BURN_BPS = 3000  # 30% reverse-burn
    
    # BBB allocation
    BBB_BURN_BPS = 7000  # 70% burned
    BBB_LP_BPS = 3000    # 30% to LP
    
    # Initial state
    INITIAL_XF_SUPPLY = 100_000_000  # 100M XF
    INITIAL_XF_PRICE = 0.10  # $0.10
    INITIAL_TVL = 1_000_000  # $1M
    INITIAL_MONTHLY_REVENUE = 50_000  # $50K/month
    
    # veXF
    VEXF_LOCK_RATE = 0.40  # 40%
    VEXF_AVG_MULTIPLIER = 3.5


# ============================================================================
# SIMULATION ENGINE
# ============================================================================

class Simulator:
    def __init__(self):
        self.config = Config()
        self.history = []
    
    def init_state(self):
        return {
            'month': 0,
            'xf_supply': self.config.INITIAL_XF_SUPPLY,
            'xf_price': self.config.INITIAL_XF_PRICE,
            'tvl': self.config.INITIAL_TVL,
            'monthly_revenue': self.config.INITIAL_MONTHLY_REVENUE,
            'lp_depth': self.config.INITIAL_TVL * 0.3,
            'vexf_locked': self.config.INITIAL_XF_SUPPLY * self.config.VEXF_LOCK_RATE,
            'treasury': 0,
            'burned': 0,
            'holder_rewards': 0
        }
    
    def calculate_splits(self, revenue):
        splits = {
            'bbb': revenue * self.config.BBB_BPS / 10000,
            'lp': revenue * self.config.LP_BPS / 10000,
            'vexf': revenue * self.config.VEXF_BPS / 10000,
            'treasury': revenue * self.config.TREASURY_BPS / 10000
        }
        
        splits['vexf_holders'] = splits['vexf'] * self.config.VEXF_HOLDER_BPS / 10000
        splits['vexf_reverse'] = splits['vexf'] * self.config.VEXF_REVERSE_BURN_BPS / 10000
        splits['bbb_burn'] = splits['bbb'] * self.config.BBB_BURN_BPS / 10000
        splits['bbb_lp'] = splits['bbb'] * self.config.BBB_LP_BPS / 10000
        
        return splits
    
    def process_month(self, state, stress=None):
        if stress is None:
            stress = {}
        
        # Apply stress factors
        revenue = state['monthly_revenue'] * stress.get('revenue_mult', 1.0)
        xf_price = state['xf_price'] * stress.get('price_mult', 1.0)
        tvl = state['tvl'] * stress.get('tvl_mult', 1.0)
        
        # Calculate splits
        splits = self.calculate_splits(revenue)
        
        # Reverse-burn boost
        reverse_burn = splits['vexf_reverse']
        
        # BBB: Burn tokens
        xf_burned = splits['bbb_burn'] / xf_price if xf_price > 0 else 0
        new_supply = max(state['xf_supply'] - xf_burned, 10_000_000)
        total_burned = state['burned'] + xf_burned
        
        # LP: Add liquidity
        lp_add = splits['lp'] + splits['bbb_lp']
        new_lp = state['lp_depth'] + lp_add
        
        # LP growth effect
        lp_growth = 1 + (lp_add / state['lp_depth']) * 0.1
        new_tvl = tvl * lp_growth
        
        # veXF: Holder rewards
        holder_rewards = state['holder_rewards'] + splits['vexf_holders']
        
        # Treasury
        treasury = state['treasury'] + splits['treasury']
        
        # Next revenue (includes reverse-burn)
        tvl_growth_rate = (new_tvl - tvl) / tvl if tvl > 0 else 0
        base_growth = tvl_growth_rate * 0.5
        next_revenue = revenue * (1 + base_growth) + reverse_burn
        
        # Price dynamics
        burn_pressure = xf_burned / state['xf_supply'] * 0.5
        whale_sell = stress.get('whale_sell', 0)
        sell_pressure = whale_sell / state['xf_supply'] * -0.3 if whale_sell > 0 else 0
        price_change = burn_pressure + sell_pressure
        new_price = xf_price * (1 + price_change)
        
        # veXF dynamics
        new_locks = (new_supply - state['xf_supply']) * 0.1 if new_supply > state['xf_supply'] else 0
        unlocks = state['vexf_locked'] * 0.05
        new_vexf = max(state['vexf_locked'] + new_locks - unlocks, 0)
        
        return {
            'month': state['month'] + 1,
            'xf_supply': new_supply,
            'xf_price': new_price,
            'tvl': new_tvl,
            'monthly_revenue': next_revenue,
            'lp_depth': new_lp,
            'vexf_locked': new_vexf,
            'treasury': treasury,
            'burned': total_burned,
            'holder_rewards': holder_rewards
        }
    
    def run(self, months, stress_schedule=None):
        if stress_schedule is None:
            stress_schedule = {}
        
        state = self.init_state()
        self.history = [state]
        
        for month in range(1, months + 1):
            stress = stress_schedule.get(month, {})
            state = self.process_month(state, stress)
            self.history.append(state)
        
        return self.history


# ============================================================================
# STRESS SCENARIOS
# ============================================================================

class Scenarios:
    @staticmethod
    def baseline():
        return {}
    
    @staticmethod
    def bear_market():
        return {
            3: {'revenue_mult': 0.7, 'tvl_mult': 0.9, 'price_mult': 0.85},
            6: {'revenue_mult': 0.4, 'tvl_mult': 0.6, 'price_mult': 0.5},
            9: {'revenue_mult': 0.4, 'tvl_mult': 0.6, 'price_mult': 0.3},
            12: {'revenue_mult': 0.5, 'tvl_mult': 0.7, 'price_mult': 0.4}
        }
    
    @staticmethod
    def whale_dump():
        return {
            3: {'whale_sell': 5_000_000},
            6: {'whale_sell': 4_500_000},
            9: {'whale_sell': 4_000_000},
            12: {'whale_sell': 3_500_000}
        }
    
    @staticmethod
    def flash_crash():
        return {
            6: {'price_mult': 0.2, 'tvl_mult': 0.5, 'revenue_mult': 0.3},
            7: {'price_mult': 1.2, 'tvl_mult': 1.1, 'revenue_mult': 0.8},
            8: {'price_mult': 1.15, 'tvl_mult': 1.1, 'revenue_mult': 0.9}
        }
    
    @staticmethod
    def low_yields():
        return {i: {'revenue_mult': 0.6, 'tvl_mult': 0.8} for i in range(1, 25)}
    
    @staticmethod
    def death_spiral():
        schedule = {}
        for i in range(1, 25):
            factors = {'revenue_mult': 0.4, 'price_mult': 0.95, 'tvl_mult': 0.9}
            if i % 3 == 0:
                factors['whale_sell'] = 3_000_000
            schedule[i] = factors
        return schedule


# ============================================================================
# ANALYSIS
# ============================================================================

class Analyzer:
    @staticmethod
    def calculate_metrics(history):
        final = history[-1]
        initial = history[0]
        
        return {
            'final_price': final['xf_price'],
            'final_mcap': final['xf_supply'] * final['xf_price'],
            'final_tvl': final['tvl'],
            'total_burned': final['burned'],
            'burn_rate': final['burned'] / initial['xf_supply'] * 100,
            'holder_rewards': final['holder_rewards'],
            'avg_revenue': sum(s['monthly_revenue'] for s in history) / len(history),
            'revenue_growth': (final['monthly_revenue'] - initial['monthly_revenue']) / initial['monthly_revenue'] * 100
        }
    
    @staticmethod
    def compare(baseline, stress, name):
        b_metrics = Analyzer.calculate_metrics(baseline)
        s_metrics = Analyzer.calculate_metrics(stress)
        
        resilience = {
            'price': s_metrics['final_price'] / b_metrics['final_price'] * 100,
            'mcap': s_metrics['final_mcap'] / b_metrics['final_mcap'] * 100,
            'tvl': s_metrics['final_tvl'] / b_metrics['final_tvl'] * 100,
            'revenue': s_metrics['avg_revenue'] / b_metrics['avg_revenue'] * 100
        }
        
        avg_resilience = sum(resilience.values()) / len(resilience)
        
        return {
            'scenario': name,
            'baseline': b_metrics,
            'stress': s_metrics,
            'resilience': resilience,
            'avg_resilience': avg_resilience
        }
    
    @staticmethod
    def print_report(report):
        print("\n" + "="*80)
        print(f"FERRARI TOKENOMICS STRESS TEST: {report['scenario']}")
        print("="*80)
        
        print("\nBASELINE (Normal Growth)")
        print("-" * 80)
        b = report['baseline']
        print(f"  Final XF Price:         ${b['final_price']:.4f}")
        print(f"  Final Market Cap:       ${b['final_mcap']:,.0f}")
        print(f"  Final TVL:              ${b['final_tvl']:,.0f}")
        print(f"  Total Burned:           {b['total_burned']:,.0f} XF ({b['burn_rate']:.2f}%)")
        print(f"  Holder Rewards:         ${b['holder_rewards']:,.0f}")
        print(f"  Avg Monthly Revenue:    ${b['avg_revenue']:,.0f}")
        print(f"  Revenue Growth:         {b['revenue_growth']:.1f}%")
        
        print(f"\nSTRESS ({report['scenario']})")
        print("-" * 80)
        s = report['stress']
        print(f"  Final XF Price:         ${s['final_price']:.4f}")
        print(f"  Final Market Cap:       ${s['final_mcap']:,.0f}")
        print(f"  Final TVL:              ${s['final_tvl']:,.0f}")
        print(f"  Total Burned:           {s['total_burned']:,.0f} XF ({s['burn_rate']:.2f}%)")
        print(f"  Holder Rewards:         ${s['holder_rewards']:,.0f}")
        print(f"  Avg Monthly Revenue:    ${s['avg_revenue']:,.0f}")
        print(f"  Revenue Growth:         {s['revenue_growth']:.1f}%")
        
        print("\nRESILIENCE (Stress vs Baseline)")
        print("-" * 80)
        r = report['resilience']
        print(f"  Price Retention:        {r['price']:.1f}%")
        print(f"  Market Cap Retention:   {r['mcap']:.1f}%")
        print(f"  TVL Retention:          {r['tvl']:.1f}%")
        print(f"  Revenue Retention:      {r['revenue']:.1f}%")
        
        avg = report['avg_resilience']
        if avg >= 80:
            assessment = "[OK] EXCELLENT - Model is highly resilient"
        elif avg >= 60:
            assessment = "[WARN] MODERATE - Some weakness detected"
        else:
            assessment = "[CRIT] CRITICAL - Significant vulnerability"
        
        print(f"\n  Overall Resilience:     {avg:.1f}% - {assessment}")
        print("="*80 + "\n")


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("="*80)
    print("XFUEL PROTOCOL - FERRARI TOKENOMICS STRESS TEST")
    print("="*80)
    print(f"Start: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    sim = Simulator()
    
    # Run baseline
    print("Running baseline (24 months)...")
    baseline = sim.run(24, Scenarios.baseline())
    
    # Scenarios
    scenarios = [
        ('Bear Market', Scenarios.bear_market()),
        ('Whale Dump', Scenarios.whale_dump()),
        ('Flash Crash', Scenarios.flash_crash()),
        ('Low Yield Environment', Scenarios.low_yields()),
        ('Death Spiral', Scenarios.death_spiral())
    ]
    
    results = []
    
    for name, stress in scenarios:
        print(f"Running: {name}...")
        stress_history = sim.run(24, stress)
        
        report = Analyzer.compare(baseline, stress_history, name)
        Analyzer.print_report(report)
        results.append(report)
    
    # Export JSON
    output = {
        'timestamp': datetime.now().isoformat(),
        'results': results
    }
    
    with open('tokenomics_results.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    print("\n[OK] Results exported to tokenomics_results.json")
    
    # Summary table
    print("\n" + "="*80)
    print("SUMMARY - RESILIENCE SCORES")
    print("="*80)
    print(f"{'Scenario':<25} {'Price':>10} {'TVL':>10} {'Revenue':>10} {'Overall':>10} {'Status':>10}")
    print("-" * 80)
    
    for r in results:
        res = r['resilience']
        avg = r['avg_resilience']
        status = "[OK]" if avg >= 80 else "[WARN]" if avg >= 60 else "[CRIT]"
        print(f"{r['scenario']:<25} {res['price']:>9.1f}% {res['tvl']:>9.1f}% {res['revenue']:>9.1f}% {avg:>9.1f}% {status:>10}")
    
    print("="*80)
    print("\n" + "="*80)
    print("[*] RECOMMENDATIONS:")
    print("-" * 80)
    
    for r in results:
        if r['avg_resilience'] < 50:
            print(f"[CRIT] {r['scenario']}: CRITICAL - Deploy all mitigations immediately")
        elif r['avg_resilience'] < 60:
            print(f"[WARN] {r['scenario']}: HIGH RISK - Deploy mitigations within 1 week")
        elif r['avg_resilience'] < 80:
            print(f"[WARN] {r['scenario']}: MODERATE - Plan mitigation deployment")
        else:
            print(f"[OK] {r['scenario']}: LOW RISK - Monitor but no urgent action")
    
    print("\n" + "="*80)
    print(f"Simulation Complete: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80 + "\n")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n[!] Interrupted by user")
    except Exception as e:
        print(f"\n\n[ERROR] {e}")
        import traceback
        traceback.print_exc()

