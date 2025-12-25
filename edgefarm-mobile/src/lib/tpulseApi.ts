/**
 * Theta TPulse API Listener
 * 
 * Listens for real-time TFUEL earnings pulses from Edge Nodes.
 * Provides live dashboard updates and triggers for push notifications.
 * 
 * TPulse API: Monitors Edge Node earnings and converts to real-time events.
 */

import { Platform } from 'react-native'

export interface EdgeNodeEarning {
  timestamp: number
  tfuelAmount: number
  source: 'video' | 'compute' | 'cdn' | 'storage'
  nodeAddress: string
  txHash?: string
}

export interface TPulseSummary {
  totalEarningsToday: number
  earningsThisHour: number
  last24Hours: EdgeNodeEarning[]
  activeNodes: number
  averageEarningPerHour: number
}

// Mock TPulse API endpoint (replace with real API)
const TPULSE_API_URL = 'https://api.thetaedgecloud.com/v1'
const THETA_EXPLORER_API = 'https://explorer.thetatoken.org:8443/api'

/**
 * Fetch Edge Node earnings for a given address
 */
export async function fetchEdgeNodeEarnings(
  nodeAddress: string,
  since?: number
): Promise<EdgeNodeEarning[]> {
  try {
    // Try TPulse API first (if available)
    // For now, use Theta Explorer API to fetch transactions
    const sinceTimestamp = since || Date.now() - 24 * 60 * 60 * 1000 // Last 24h
    
    const response = await fetch(
      `${THETA_EXPLORER_API}/accounttx/${nodeAddress}?type=6&pageNumber=1&limitNumber=100`
    )
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    // Parse transactions into earnings
    const earnings: EdgeNodeEarning[] = []
    
    if (data.body && Array.isArray(data.body)) {
      for (const tx of data.body) {
        // Filter for TFUEL earnings (incoming transfers)
        if (tx.type === 6 && tx.timestamp) {
          const tfuelAmount = parseFloat(tx.data?.tfuel_amount || '0') / 1e18
          
          if (tfuelAmount > 0) {
            earnings.push({
              timestamp: tx.timestamp * 1000, // Convert to ms
              tfuelAmount,
              source: classifyEarningSource(tx),
              nodeAddress,
              txHash: tx.hash,
            })
          }
        }
      }
    }
    
    // Filter by time range
    return earnings.filter(e => e.timestamp >= sinceTimestamp)
  } catch (error) {
    console.error('TPulse API error:', error)
    return []
  }
}

/**
 * Classify earning source based on transaction data
 */
function classifyEarningSource(tx: any): 'video' | 'compute' | 'cdn' | 'storage' {
  // Heuristic: classify based on amount or memo (if available in future)
  const amount = parseFloat(tx.data?.tfuel_amount || '0') / 1e18
  
  // Video/CDN earnings are typically larger (streaming revenue)
  if (amount > 10) return 'video'
  if (amount > 1) return 'cdn'
  if (amount > 0.1) return 'compute'
  return 'storage'
}

/**
 * Get TPulse summary for dashboard
 */
export async function getTPulseSummary(nodeAddress: string): Promise<TPulseSummary> {
  try {
    const earnings = await fetchEdgeNodeEarnings(nodeAddress)
    
    const now = Date.now()
    const hourAgo = now - 60 * 60 * 1000
    const dayAgo = now - 24 * 60 * 60 * 1000
    
    const earningsThisHour = earnings
      .filter(e => e.timestamp >= hourAgo)
      .reduce((sum, e) => sum + e.tfuelAmount, 0)
    
    const totalEarningsToday = earnings
      .filter(e => e.timestamp >= dayAgo)
      .reduce((sum, e) => sum + e.tfuelAmount, 0)
    
    const last24Hours = earnings.filter(e => e.timestamp >= dayAgo)
    
    // Calculate average earning per hour over last 24h
    const hoursActive = Math.min(24, (now - (earnings[earnings.length - 1]?.timestamp || now)) / (60 * 60 * 1000))
    const averageEarningPerHour = hoursActive > 0 ? totalEarningsToday / hoursActive : 0
    
    return {
      totalEarningsToday,
      earningsThisHour,
      last24Hours,
      activeNodes: 1, // TODO: support multiple nodes
      averageEarningPerHour,
    }
  } catch (error) {
    console.error('TPulse summary error:', error)
    return {
      totalEarningsToday: 0,
      earningsThisHour: 0,
      last24Hours: [],
      activeNodes: 0,
      averageEarningPerHour: 0,
    }
  }
}

/**
 * Start polling for new earnings (for real-time updates)
 */
export function startTPulsePoll(
  nodeAddress: string,
  onNewEarning: (earning: EdgeNodeEarning) => void,
  intervalMs: number = 60000 // Poll every minute
): () => void {
  let lastCheck = Date.now()
  
  const poll = async () => {
    try {
      const newEarnings = await fetchEdgeNodeEarnings(nodeAddress, lastCheck)
      
      if (newEarnings.length > 0) {
        // Sort by timestamp (oldest first)
        newEarnings.sort((a, b) => a.timestamp - b.timestamp)
        
        // Trigger callback for each new earning
        for (const earning of newEarnings) {
          onNewEarning(earning)
        }
        
        // Update last check timestamp
        lastCheck = Date.now()
      }
    } catch (error) {
      console.error('TPulse poll error:', error)
    }
  }
  
  // Initial poll
  poll()
  
  // Set up interval
  const intervalId = setInterval(poll, intervalMs)
  
  // Return cleanup function
  return () => clearInterval(intervalId)
}

/**
 * Get demo/mock earnings for testing (simulated Edge Node pulses)
 */
export function getDemoEarnings(): EdgeNodeEarning[] {
  const now = Date.now()
  const demos: EdgeNodeEarning[] = []
  
  // Generate demo earnings for last 24 hours
  for (let i = 0; i < 24; i++) {
    const timestamp = now - i * 60 * 60 * 1000
    const tfuelAmount = Math.random() * 5 + 1 // Random 1-6 TFUEL
    const sources: Array<'video' | 'compute' | 'cdn' | 'storage'> = ['video', 'compute', 'cdn', 'storage']
    const source = sources[Math.floor(Math.random() * sources.length)]
    
    demos.push({
      timestamp,
      tfuelAmount,
      source,
      nodeAddress: '0x1234...5678',
    })
  }
  
  return demos.sort((a, b) => b.timestamp - a.timestamp) // Newest first
}

