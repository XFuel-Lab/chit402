import React, { useCallback, useState, useEffect } from 'react'
import { FlatList, RefreshControl, Text, View, Pressable, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScreenBackground } from '../components/ScreenBackground'
import { NeonCard } from '../components/NeonCard'
import { neon } from '../theme/neon'
import { type } from '../theme/typography'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'

type Transaction = {
  id: string
  type: 'swap' | 'stake' | 'tip' | 'lottery' | 'withdraw'
  amount: number
  token: string
  timestamp: number
  status: 'pending' | 'completed' | 'failed'
  txHash?: string
  description: string
}

// Mock data generator
const generateMockTransaction = (id: number, offset: number): Transaction => {
  const types: Transaction['type'][] = ['swap', 'stake', 'tip', 'lottery', 'withdraw']
  const tokens = ['TFUEL', 'stkTIA', 'stkATOM', 'stkXPRT', 'pSTAKE BTC']
  const statuses: Transaction['status'][] = ['pending', 'completed', 'failed']
  
  const type = types[Math.floor(Math.random() * types.length)]
  const token = tokens[Math.floor(Math.random() * tokens.length)]
  const status = statuses[Math.floor(Math.random() * statuses.length)]
  const amount = Math.random() * 1000 + 10
  
  const descriptions: Record<Transaction['type'], string> = {
    swap: `Swapped ${amount.toFixed(2)} TFUEL → ${token}`,
    stake: `Staked ${amount.toFixed(2)} ${token}`,
    tip: `Tipped ${amount.toFixed(2)} TFUEL on Cloud9 vs Dignitas`,
    lottery: `Won ${amount.toFixed(2)} TFUEL from fan lottery`,
    withdraw: `Withdrew ${amount.toFixed(2)} ${token}`,
  }
  
  return {
    id: `tx-${id}`,
    type,
    amount,
    token,
    timestamp: Date.now() - offset * 1000 * 60 * (Math.random() * 60 + 1),
    status,
    txHash: status === 'completed' ? `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}` : undefined,
    description: descriptions[type],
  }
}

const getExplorerUrl = () => 'https://testnet-explorer.thetatoken.org'

export function TransactionHistoryScreen() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)

  const loadTransactions = useCallback(async (pageNum: number, isRefresh = false) => {
    if (loading && !isRefresh) return
    
    setLoading(true)
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 800))
    
    const newTransactions = Array.from({ length: 20 }, (_, i) =>
      generateMockTransaction(pageNum * 20 + i, pageNum * 20 + i)
    )
    
    if (isRefresh) {
      setTransactions(newTransactions)
      setPage(1)
    } else {
      setTransactions(prev => [...prev, ...newTransactions])
      setPage(pageNum + 1)
    }
    
    // Stop loading more after 5 pages (100 transactions)
    if (pageNum >= 4) {
      setHasMore(false)
    }
    
    setLoading(false)
  }, [loading])

  useEffect(() => {
    loadTransactions(0, true)
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setHasMore(true)
    await loadTransactions(0, true)
    setRefreshing(false)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  }, [loadTransactions])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadTransactions(page)
    }
  }, [loading, hasMore, page, loadTransactions])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const getTypeColor = (txType: Transaction['type']) => {
    switch (txType) {
      case 'swap':
        return neon.blue
      case 'stake':
        return neon.green
      case 'tip':
        return neon.purple
      case 'lottery':
        return neon.pink
      case 'withdraw':
        return 'rgba(148,163,184,0.9)'
      default:
        return neon.blue
    }
  }

  const getTypeIcon = (txType: Transaction['type']) => {
    switch (txType) {
      case 'swap':
        return 'swap-horizontal'
      case 'stake':
        return 'trending-up'
      case 'tip':
        return 'heart'
      case 'lottery':
        return 'trophy'
      case 'withdraw':
        return 'arrow-down'
      default:
        return 'ellipse'
    }
  }

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'completed':
        return neon.green
      case 'pending':
        return 'rgba(251,191,36,0.9)'
      case 'failed':
        return neon.pink
      default:
        return 'rgba(148,163,184,0.9)'
    }
  }

  return (
    <ScreenBackground wallpaperVariant="image">
      <SafeAreaView className="flex-1">
        <View className="px-5 pt-3 pb-2">
          <Text style={{ ...type.h2, color: 'rgba(255,255,255,0.95)' }}>Transaction History</Text>
          <Text style={{ ...type.caption, marginTop: 6, color: 'rgba(255,255,255,0.55)' }}>
            All your XFUEL activity
          </Text>
        </View>

        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 20, paddingTop: 10, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={neon.blue}
              colors={[neon.blue]}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <NeonCard>
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ ...type.h3, color: 'rgba(255,255,255,0.95)' }}>No transactions yet</Text>
                <Text style={{ ...type.caption, marginTop: 8, color: 'rgba(148,163,184,0.9)', textAlign: 'center' }}>
                  Your transaction history will appear here
                </Text>
              </View>
            </NeonCard>
          }
          renderItem={({ item }) => (
            <NeonCard className="mb-3">
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 16,
                    backgroundColor: `${getTypeColor(item.type)}20`,
                    borderWidth: 1,
                    borderColor: `${getTypeColor(item.type)}60`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={getTypeIcon(item.type) as any} size={24} color={getTypeColor(item.type)} />
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ ...type.bodyM, color: 'rgba(255,255,255,0.95)' }}>{item.description}</Text>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: `${getStatusColor(item.status)}20`,
                        borderWidth: 1,
                        borderColor: `${getStatusColor(item.status)}60`,
                      }}
                    >
                      <Text style={{ ...type.caption, fontSize: 10, color: getStatusColor(item.status) }}>
                        {item.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    <Text style={{ ...type.caption, color: getTypeColor(item.type) }}>
                      {item.amount.toFixed(2)} {item.token}
                    </Text>
                    <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.7)' }}>•</Text>
                    <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>{formatTime(item.timestamp)}</Text>
                  </View>

                  {item.txHash && (
                    <Pressable
                      onPress={() => {
                        const url = `${getExplorerUrl()}/tx/${item.txHash}`
                        Linking.openURL(url).catch(() => {})
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
                      }}
                      style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <Text style={{ ...type.caption, color: neon.blue, textDecorationLine: 'underline' }}>
                        View on explorer
                      </Text>
                      <Ionicons name="open-outline" size={14} color={neon.blue} />
                    </Pressable>
                  )}
                </View>
              </View>
            </NeonCard>
          )}
          ListFooterComponent={
            loading && !refreshing ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.9)' }}>Loading more...</Text>
              </View>
            ) : !hasMore ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <Text style={{ ...type.caption, color: 'rgba(148,163,184,0.7)' }}>No more transactions</Text>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </ScreenBackground>
  )
}

