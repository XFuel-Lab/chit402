// Add to src/components/StrideAccountHelp.tsx

export default function StrideAccountHelp({ strideAddress }: { strideAddress?: string }) {
  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-4">
      <h4 className="text-blue-400 font-semibold mb-2">
        📝 Stride Account Setup Required
      </h4>
      <div className="text-sm text-slate-300 space-y-3">
        <p>
          Your Stride address needs to be initialized before staking:
        </p>
        
        {strideAddress && (
          <div className="bg-slate-800/50 rounded p-2 font-mono text-xs break-all">
            {strideAddress}
          </div>
        )}
        
        <div className="space-y-2">
          <p className="font-semibold text-slate-200">How to fix:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>
              <strong>Get STRD tokens</strong>
              <ul className="list-disc list-inside ml-4 mt-1 text-xs">
                <li>Use <a href="https://app.osmosis.zone" target="_blank" rel="noopener" className="text-blue-400 hover:underline">Osmosis DEX</a> to swap for STRD</li>
                <li>Or buy on a CEX and withdraw to your Stride address</li>
              </ul>
            </li>
            <li>
              <strong>Send 0.1-1 STRD</strong> to your Stride address above
            </li>
            <li>
              <strong>Retry staking</strong> - your account will now be active!
            </li>
          </ol>
        </div>
        
        <p className="text-xs text-slate-400 mt-3">
          💡 <strong>Why?</strong> Cosmos chains only create accounts after the first transaction. 
          This is a one-time setup - future staking will work instantly.
        </p>
      </div>
    </div>
  )
}

