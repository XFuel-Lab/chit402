/**
 * Rate Limiting Utility for External APIs
 * Handles 429 (Too Many Requests) errors with exponential backoff retry logic
 */

interface RateLimitConfig {
  maxRetries?: number
  initialDelay?: number
  maxDelay?: number
  backoffMultiplier?: number
}

const DEFAULT_CONFIG: Required<RateLimitConfig> = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch with rate limiting and retry logic
 * Automatically retries on 429 errors with exponential backoff
 */
export async function fetchWithRateLimit(
  url: string,
  options: RequestInit = {},
  config: RateLimitConfig = {}
): Promise<Response> {
  const {
    maxRetries,
    initialDelay,
    maxDelay,
    backoffMultiplier,
  } = { ...DEFAULT_CONFIG, ...config }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Accept': 'application/json',
          ...options.headers,
        },
      })

      // If successful or non-rate-limit error, return immediately
      if (response.ok || response.status !== 429) {
        return response
      }

      // Handle 429 rate limit error
      if (response.status === 429) {
        // Check if Retry-After header is present
        const retryAfter = response.headers.get('Retry-After')
        let delay = initialDelay

        if (retryAfter) {
          // Use Retry-After header if available (in seconds)
          delay = parseInt(retryAfter, 10) * 1000
        } else {
          // Exponential backoff: delay = initialDelay * (backoffMultiplier ^ attempt)
          delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, attempt),
            maxDelay
          )
        }

        // If this is the last attempt, throw error
        if (attempt === maxRetries) {
          throw new Error(
            `Rate limit exceeded after ${maxRetries + 1} attempts. Please try again later.`
          )
        }

        console.warn(
          `⚠️ CoinGecko rate limit (429) - attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms...`
        )

        await sleep(delay)
        continue
      }

      // For other non-ok responses, return as-is (caller will handle)
      return response
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // If it's a network error and we have retries left, retry
      if (attempt < maxRetries && error instanceof TypeError) {
        const delay = Math.min(
          initialDelay * Math.pow(backoffMultiplier, attempt),
          maxDelay
        )
        console.warn(
          `⚠️ Network error - attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms...`
        )
        await sleep(delay)
        continue
      }

      // If no retries left or non-network error, throw
      throw lastError
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error('Unknown error in fetchWithRateLimit')
}

/**
 * Request queue to prevent too many simultaneous requests
 */
class RequestQueue {
  private queue: Array<() => Promise<any>> = []
  private processing = false
  private readonly maxConcurrent: number
  private readonly minDelay: number
  private lastRequestTime = 0

  constructor(maxConcurrent: number = 2, minDelay: number = 1000) {
    this.maxConcurrent = maxConcurrent
    this.minDelay = minDelay
  }

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })

      this.process()
    })
  }

  private async process() {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime

      // Enforce minimum delay between requests
      if (timeSinceLastRequest < this.minDelay) {
        await sleep(this.minDelay - timeSinceLastRequest)
      }

      const fn = this.queue.shift()
      if (fn) {
        this.lastRequestTime = Date.now()
        try {
          await fn()
        } catch (error) {
          // Error is already handled in the enqueued function
          console.error('Request queue error:', error)
        }
      }
    }

    this.processing = false
  }
}

// Global request queue for CoinGecko API
const coingeckoQueue = new RequestQueue(1, 1200) // Max 1 concurrent, min 1.2s between requests

/**
 * Fetch from CoinGecko API with rate limiting and queuing
 */
export async function fetchCoinGecko(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return coingeckoQueue.enqueue(() =>
    fetchWithRateLimit(url, options, {
      maxRetries: 3,
      initialDelay: 2000, // Start with 2 second delay for CoinGecko
      maxDelay: 60000, // Max 60 seconds delay
      backoffMultiplier: 2,
    })
  )
}

