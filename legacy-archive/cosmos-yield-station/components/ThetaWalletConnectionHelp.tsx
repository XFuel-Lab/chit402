// Add to src/components/ThetaWalletConnectionHelp.tsx

export default function ThetaWalletConnectionHelp() {
  return (
    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-4">
      <h4 className="text-yellow-400 font-semibold mb-2">
        ⚠️ Theta Wallet Connection Issue?
      </h4>
      <div className="text-sm text-slate-300 space-y-2">
        <p><strong>If the Connect button is disabled in Theta Wallet:</strong></p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>Close the Theta Wallet app completely</li>
          <li>Reopen Theta Wallet</li>
          <li>Try connecting again from XFUEL</li>
          <li>If still not working, use MetaMask instead (fully supported)</li>
        </ol>
        
        <p className="mt-3"><strong>Alternative:</strong> Use MetaMask mobile with Theta Network configured for seamless connection.</p>
      </div>
    </div>
  )
}

