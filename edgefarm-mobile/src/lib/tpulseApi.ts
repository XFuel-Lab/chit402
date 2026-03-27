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

// NOTE: There is no public "TPulse" earnings API on thetaedgecloud.com.
// api.thetaedgecloud.com/v1 is the EdgeCloud deployment management API (vm/list, deployments, etc.)
// Edge Node earnings are obtained via the Theta Explorer API (/accounttx/:address).
// The constant below is kept as a placeholder for a potential future Theta earnings endpoint.
const TPULSE_API_URL = 'https://api.thetaedgecloud.com/v1' // deployment mgmt API — not for earnings
const THETA_EXPLORER_API = 'https://explorer-api.thetatoken.org/api'

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
    
    // Fetch type=2 (send transactions — TFUEL earned by edge nodes arrives as sends from reward distributor)
    // Transaction type reference (from Explorer API docs):
    //   0 = coinbase (validator/guardian reward), 1 = slash, 2 = send, 3 = reserve fund,
    //   4 = release fund, 5 = service payment, 6 = split rule (NOT earnings), 7 = smart contract,
    //   8 = deposit stake, 9 = withdraw stake
    // Edge Node TFUEL earnings arrive as type-2 (send) from the network reward pool.
    const response = await fetch(
      `${THETA_EXPLORER_API}/accounttx/${nodeAddress}?type=2&pageNumber=1&limitNumber=100&isEqualType=true`
    )
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    // Parse transactions into earnings
    const earnings: EdgeNodeEarning[] = []
    
    if (data.body && Array.isArray(data.body)) {
      for (const tx of data.body) {
        // type=2 send transactions from Explorer API:
        // tx.data.outputs = [{ address, coins: { thetawei, tfuelwei } }]
        // tx.data.inputs  = [{ address, coins: { thetawei, tfuelwei } }]
        // We want incoming sends where one of the outputs matches nodeAddress
        if (tx.type === 2 && tx.timestamp) {
          const outputs: Array<{ address: string; coins: { tfuelwei: string } }> =
            tx.data?.outputs || []
          const matchingOutput = outputs.find(
            (o) => o.address?.toLowerCase() === nodeAddress.toLowerCase()
          )
          if (matchingOutput) {
            const tfuelAmount = parseFloat(matchingOutput.coins?.tfuelwei || '0') / 1e18
            if (tfuelAmount > 0) {
              earnings.push({
                timestamp: tx.timestamp * 1000,
                tfuelAmount,
                source: classifyEarningSource(tx),
                nodeAddress,
                txHash: tx.hash,
              })
            }
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
 * Classify earning source based on transaction amount heuristic.
 * Edge nodes earn small fractions of TFUEL per reward cycle.
 * Without a dedicated earnings API, amounts are used as a rough proxy.
 */
function classifyEarningSource(tx: any): 'video' | 'compute' | 'cdn' | 'storage' {
  // Sum all outputs to get total sent (rough heuristic only)
  const outputs: Array<{ coins: { tfuelwei: string } }> = tx.data?.outputs || []
  const totalWei = outputs.reduce(
    (sum, o) => sum + parseFloat(o.coins?.tfuelwei || '0'),
    0
  )
  const amount = totalWei / 1e18

  // Small amounts typical of CDN/relay; larger ones suggest compute or video
  if (amount > 1) return 'video'
  if (amount > 0.1) return 'compute'
  if (amount > 0.01) return 'cdn'
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

