import { useState, useEffect, useMemo } from 'react'
import { ethers } from 'ethers'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import ApyOrb from './ApyOrb'
import confetti from 'canvas-confetti'

interface Poll {
  id: number
  title: string
  description: string
  options: PollOption[]
  startTime: number
  endTime: number
  totalVotes: number
  status: 'active' | 'ended'
  category: 'bonus' | 'treasury' | 'milestones'
}

interface PollOption {
  id: number
  label: string
  votes: number
  percentage: number
}

interface VoteRecord {
  pollId: number
  optionId: number
  veXFAmount: number
  rXFBonus: number
  timestamp: number
}

interface Props {
  userAddress: string | null
  veXFBalance: number
  rXFBalance: number
  onVote: (pollId: number, optionId: number) => Promise<void>
  onToggleMaintenance?: () => void
  isMaintenanceMode?: boolean
}

// Mock governance polls - in production, fetch from contracts/backend
const GOVERNANCE_POLLS: Poll[] = [
  {
    id: 1,
    title: 'Q1 2026 LP Bonus Distribution',
    description: '5-10% of LP revenue extras: How should we distribute quarterly bonuses to reward participants?',
    options: [
      { id: 1, label: 'Extra XF Burns (reduce supply)', votes: 12500, percentage: 42.3 },
      { id: 2, label: 'Additional LP Funding (deeper liquidity)', votes: 9800, percentage: 33.1 },
      { id: 3, label: 'NFT Airdrops (milestone rewards)', votes: 7300, percentage: 24.6 },
    ],
    startTime: Date.now() - 7 * 24 * 60 * 60 * 1000, // Started 7 days ago
    endTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // Ends in 7 days
    totalVotes: 29600,
    status: 'active',
    category: 'bonus',
  },
  {
    id: 2,
    title: 'Milestone Bonus: 100M TVL Achievement',
    description: 'We hit $100M TVL! How should we reward the community for this milestone?',
    options: [
      { id: 1, label: 'Legendary NFT Airdrop (top 100 LPs)', votes: 8200, percentage: 51.2 },
      { id: 2, label: '2x rXF rewards for 30 days', votes: 5100, percentage: 31.9 },
      { id: 3, label: 'Treasury buyback & burn', votes: 2700, percentage: 16.9 },
    ],
    startTime: Date.now() - 3 * 24 * 60 * 60 * 1000,
    endTime: Date.now() + 11 * 24 * 60 * 60 * 1000,
    totalVotes: 16000,
    status: 'active',
    category: 'milestones',
  },
  {
    id: 3,
    title: 'Q4 2025 Results - LP Reinvestment Rate',
    description: 'Previous poll: 70% LP reinvestment vs 30% treasury allocation',
    options: [
      { id: 1, label: '70% LP Reinvestment (winner)', votes: 18900, percentage: 67.5 },
      { id: 2, label: '50/50 split', votes: 6200, percentage: 22.1 },
      { id: 3, label: '30% LP / 70% treasury', votes: 2900, percentage: 10.4 },
    ],
    startTime: Date.now() - 90 * 24 * 60 * 60 * 1000,
    endTime: Date.now() - 60 * 24 * 60 * 60 * 1000,
    totalVotes: 28000,
    status: 'ended',
    category: 'treasury',
  },
]

export default function GovernanceTab({
  userAddress,
  veXFBalance,
  rXFBalance,
  onVote,
  onToggleMaintenance,
  isMaintenanceMode,
}: Props) {
  const [selectedPollId, setSelectedPollId] = useState<number | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null)
  const [isVoting, setIsVoting] = useState(false)
  const [voteHistory, setVoteHistory] = useState<VoteRecord[]>([])
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'ended'>('active')

  // Calculate total voting power (veXF + rXF bonus)
  const totalVotingPower = useMemo(() => {
    return veXFBalance + rXFBalance * 4 // rXF has 4× voting boost
  }, [veXFBalance, rXFBalance])

  // Filter polls by status
  const filteredPolls = useMemo(() => {
    if (filterStatus === 'all') return GOVERNANCE_POLLS
    return GOVERNANCE_POLLS.filter((poll) => poll.status === filterStatus)
  }, [filterStatus])

  // Check if user has already voted on a poll
  const hasVoted = (pollId: number) => {
    return voteHistory.some((record) => record.pollId === pollId)
  }

  // Handle vote submission
  const handleVote = async (pollId: number, optionId: number) => {
    if (!userAddress) {
      alert('Please connect your wallet to vote')
      return
    }

    if (totalVotingPower === 0) {
      alert('You need veXF or rXF tokens to vote. Lock XF tokens to receive veXF.')
      return
    }

    if (hasVoted(pollId)) {
      alert('You have already voted on this poll')
      return
    }

    setIsVoting(true)
    try {
      await onVote(pollId, optionId)

      // Calculate rXF bonus (5% of voting power as rXF reward)
      const rXFBonus = totalVotingPower * 0.05

      // Record vote locally
      const newVote: VoteRecord = {
        pollId,
        optionId,
        veXFAmount: veXFBalance,
        rXFBonus,
        timestamp: Date.now(),
      }
      setVoteHistory([...voteHistory, newVote])

      // Celebration animation
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#a855f7', '#06b6d4', '#ec4899'],
      })

      alert(`Vote submitted! You earned ${rXFBonus.toFixed(2)} rXF as a bonus! 🎉`)
    } catch (error) {
      console.error('Vote failed:', error)
      alert('Vote failed. Please try again.')
    } finally {
      setIsVoting(false)
      setSelectedPollId(null)
      setSelectedOptionId(null)
    }
  }

  // Format time remaining
  const formatTimeRemaining = (endTime: number) => {
    const now = Date.now()
    const diff = endTime - now
    
    if (diff <= 0) return 'Ended'
    
    const days = Math.floor(diff / (24 * 60 * 60 * 1000))
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
    
    if (days > 0) return `${days}d ${hours}h remaining`
    return `${hours}h remaining`
  }

  // Get category badge color
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'bonus':
        return 'from-purple-500 to-pink-500'
      case 'treasury':
        return 'from-cyan-500 to-blue-500'
      case 'milestones':
        return 'from-yellow-500 to-orange-500'
      default:
        return 'from-purple-500 to-pink-500'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <GlassCard className="p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white">
              veXF Governance
            </h2>
            <p className="text-sm text-slate-300">
              Vote on LP revenue distribution, milestone bonuses, and protocol decisions
            </p>
            <p className="text-xs text-slate-400">
              Quarterly votes on 5-10% LP revenue extras • Earn rXF bonuses for voting
            </p>
          </div>

          {/* Voting Power Display */}
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-slate-400">Your Voting Power</p>
                <p className="text-2xl font-bold text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text">
                  {totalVotingPower.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="w-16 h-16">
                <ApyOrb 
                  apyText={totalVotingPower > 0 ? '✓' : '—'} 
                  label="" 
                />
              </div>
            </div>
            <div className="flex gap-4 text-xs">
              <div className="text-right">
                <p className="text-slate-400">veXF</p>
                <p className="text-white font-semibold">{veXFBalance.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-400">rXF (4× boost)</p>
                <p className="text-white font-semibold">{(rXFBalance * 4).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Filter Tabs */}
      <div className="flex gap-2 justify-center">
        {(['all', 'active', 'ended'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilterStatus(status)}
            className={[
              'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
              filterStatus === status
                ? 'bg-gradient-to-r from-purple-500 to-cyan-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.6)]'
                : 'bg-white/5 text-slate-300 hover:bg-white/10',
            ].join(' ')}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Polls List */}
      <div className="space-y-4">
        {filteredPolls.map((poll) => {
          const voted = hasVoted(poll.id)
          const votedOption = voteHistory.find((v) => v.pollId === poll.id)?.optionId

          return (
            <GlassCard key={poll.id} className="p-6 space-y-4">
              {/* Poll Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={[
                        'inline-block px-3 py-1 rounded-full text-xs font-semibold text-white',
                        `bg-gradient-to-r ${getCategoryColor(poll.category)}`,
                      ].join(' ')}
                    >
                      {poll.category.toUpperCase()}
                    </span>
                    <span
                      className={[
                        'inline-block px-3 py-1 rounded-full text-xs font-semibold',
                        poll.status === 'active'
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-slate-500/20 text-slate-300',
                      ].join(' ')}
                    >
                      {poll.status === 'active' ? formatTimeRemaining(poll.endTime) : 'Ended'}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white">{poll.title}</h3>
                  <p className="text-sm text-slate-300">{poll.description}</p>
                  <p className="text-xs text-slate-400">
                    Total votes: {poll.totalVotes.toLocaleString()}
                  </p>
                </div>

                {voted && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30">
                    <span className="text-green-400 text-xl">✓</span>
                    <span className="text-xs font-semibold text-green-300">Voted</span>
                  </div>
                )}
              </div>

              {/* Poll Options */}
              <div className="space-y-3">
                {poll.options.map((option) => {
                  const isSelected = selectedPollId === poll.id && selectedOptionId === option.id
                  const isVotedOption = votedOption === option.id

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        if (poll.status === 'active' && !voted) {
                          setSelectedPollId(poll.id)
                          setSelectedOptionId(option.id)
                        }
                      }}
                      disabled={poll.status === 'ended' || voted}
                      className={[
                        'w-full text-left p-4 rounded-lg border transition-all duration-200',
                        'relative overflow-hidden',
                        isSelected
                          ? 'border-purple-400 bg-purple-500/10'
                          : isVotedOption
                          ? 'border-green-400 bg-green-500/10'
                          : 'border-white/10 bg-white/5 hover:bg-white/10',
                        poll.status === 'ended' || voted
                          ? 'cursor-default'
                          : 'cursor-pointer hover:border-purple-400/50',
                      ].join(' ')}
                    >
                      {/* Progress Bar Background */}
                      <div
                        className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 transition-all duration-500"
                        style={{ width: `${option.percentage}%` }}
                      />

                      {/* Content */}
                      <div className="relative z-10 flex items-center justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white mb-1">
                            {option.label}
                          </p>
                          <p className="text-xs text-slate-400">
                            {option.votes.toLocaleString()} votes
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text">
                            {option.percentage.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Vote Button */}
              {poll.status === 'active' && !voted && selectedPollId === poll.id && (
                <div className="pt-2">
                  <NeonButton
                    label={isVoting ? 'Submitting Vote...' : 'Submit Vote & Earn rXF Bonus'}
                    variant="primary"
                    disabled={isVoting || selectedOptionId === null}
                    onClick={() => {
                      if (selectedOptionId !== null) {
                        handleVote(poll.id, selectedOptionId)
                      }
                    }}
                    className="w-full"
                  />
                  <p className="text-xs text-center text-slate-400 mt-2">
                    You'll earn ~{(totalVotingPower * 0.05).toFixed(2)} rXF for voting
                  </p>
                </div>
              )}
            </GlassCard>
          )
        })}
      </div>

      {/* Maintenance Toggle (Admin Only) */}
      {onToggleMaintenance && (
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Maintenance Mode</h3>
              <p className="text-sm text-slate-300">
                Toggle maintenance mode for protocol updates
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleMaintenance}
              className={[
                'relative inline-flex h-8 w-14 items-center rounded-full transition-colors',
                isMaintenanceMode ? 'bg-orange-500' : 'bg-slate-600',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-6 w-6 transform rounded-full bg-white transition-transform',
                  isMaintenanceMode ? 'translate-x-7' : 'translate-x-1',
                ].join(' ')}
              />
            </button>
          </div>
        </GlassCard>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="p-4">
          <h4 className="text-sm font-semibold text-slate-400 mb-2">Voting Rewards</h4>
          <p className="text-2xl font-bold text-transparent bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text">
            5% rXF Bonus
          </p>
          <p className="text-xs text-slate-300 mt-1">
            Earn rXF tokens for every vote cast
          </p>
        </GlassCard>

        <GlassCard className="p-4">
          <h4 className="text-sm font-semibold text-slate-400 mb-2">Quarterly Polls</h4>
          <p className="text-2xl font-bold text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text">
            5-10% Revenue
          </p>
          <p className="text-xs text-slate-300 mt-1">
            LP revenue extras up for vote
          </p>
        </GlassCard>

        <GlassCard className="p-4">
          <h4 className="text-sm font-semibold text-slate-400 mb-2">Active Polls</h4>
          <p className="text-2xl font-bold text-transparent bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text">
            {GOVERNANCE_POLLS.filter((p) => p.status === 'active').length}
          </p>
          <p className="text-xs text-slate-300 mt-1">
            Currently accepting votes
          </p>
        </GlassCard>
      </div>
    </div>
  )
}



