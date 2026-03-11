import { useEffect, useState } from 'react'

interface MaintenanceOverlayProps {
  isEnabled: boolean
}

export default function MaintenanceOverlay({ isEnabled }: MaintenanceOverlayProps) {
  const [isVisible, setIsVisible] = useState(false)

  // Debug logging
  console.log('🔧 MaintenanceOverlay render:', { isEnabled, isVisible })

  useEffect(() => {
    // Fade in animation on mount
    if (isEnabled) {
      console.log('✅ Maintenance mode ENABLED - showing overlay')
      const timer = setTimeout(() => {
        setIsVisible(true)
        console.log('✅ isVisible set to TRUE - overlay should fade in now')
      }, 50)
      return () => clearTimeout(timer)
    } else {
      console.log('❌ Maintenance mode DISABLED - hiding overlay')
      setIsVisible(false)
    }
  }, [isEnabled])

  if (!isEnabled) {
    console.log('⚠️ isEnabled is false, returning null')
    return null
  }

  console.log('✅ Rendering maintenance overlay div')

  return (
    <div
      className={`maintenance-overlay ${isVisible ? 'maintenance-overlay-visible' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="maintenance-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        background: 'rgba(0, 0, 0, 0.92)',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.5s ease-out',
        pointerEvents: 'all',
      }}
    >
      <div className="maintenance-content">
        {/* Animated background particles */}
        <div className="maintenance-particles" />
        
        {/* Main content */}
        <div className="maintenance-inner">
          {/* Logo/Icon */}
          <div className="maintenance-icon-wrapper">
            <div className="maintenance-icon">
              <span className="maintenance-icon-emoji">🚧</span>
            </div>
          </div>

          {/* Title */}
          <h1 id="maintenance-title" className="maintenance-title">
            Project Under Construction
          </h1>

          {/* Message */}
          <p className="maintenance-message">
            Temporarily Out of Service
          </p>

          {/* Exciting news */}
          <div className="maintenance-announcement">
            <div className="maintenance-announcement-icon">⚡</div>
            <p className="maintenance-announcement-text">
              Exciting ZK Upgrades Coming Soon!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

