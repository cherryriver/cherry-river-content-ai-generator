import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Image, Video, Layers, Package, DollarSign, Download, Play, ArrowRight, Sparkles, Loader2, ImageOff, ArrowUpRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/apiFetch'

const API_URL = import.meta.env.VITE_API_URL || ''

const statMeta = [
  { key: 'images', label: 'Images Generated', icon: Image, accentColor: '#C41E3A', glowColor: 'rgba(196,30,58,0.2)', borderColor: 'rgba(196,30,58,0.4)' },
  { key: 'videos', label: 'Videos Created', icon: Video, accentColor: '#D4AF37', glowColor: 'rgba(212,175,55,0.15)', borderColor: 'rgba(212,175,55,0.35)' },
  { key: 'products', label: 'Products', icon: Package, accentColor: '#3B82F6', glowColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.3)' },
  { key: 'thisMonthSpent', label: 'Spent This Month', icon: DollarSign, accentColor: '#22C55E', glowColor: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.3)', format: (v) => `$${(v || 0).toFixed(2)}` },
]

async function downloadImage(url, product, e) {
  if (e) e.stopPropagation()
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `${product}-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  } catch {
    window.open(url, '_blank')
  }
}

export default function Dashboard() {
  const { user } = useAuth()
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'back'
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch(`${API_URL}/api/stats`).then(r => r.json()),
      apiFetch(`${API_URL}/api/generations?limit=6`).then(r => r.json()),
    ])
      .then(([statsData, recentData]) => {
        setStats(statsData)
        setRecent(recentData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-1 h-7 rounded-full bg-cherry shadow-[0_0_10px_rgba(196,30,58,0.6)] flex-shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">Welcome back, {displayName}</h1>
          </div>
          <p className="text-gray-500 text-sm pl-4">Here's what's happening with your content today.</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 bg-[#11111C] rounded-full px-4 py-2 border border-white/5 flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_6px_#22C55E]" />
          <span className="text-xs text-gray-400 font-medium">All systems live</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statMeta.map(({ key, label, icon: Icon, accentColor, glowColor, borderColor, format }) => (
          <div
            key={key}
            className="group relative bg-[#11111C] backdrop-blur-sm rounded-2xl p-5 border border-white/5 overflow-hidden cursor-default transition-all duration-300"
            style={{
              '--glow': glowColor,
              '--border': borderColor,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = borderColor
              e.currentTarget.style.boxShadow = `0 0 30px ${glowColor}`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            {/* Top accent border */}
            <div className="absolute top-0 left-4 right-4 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}80, transparent)` }} />

            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accentColor}15` }}>
                <Icon className="w-5 h-5" style={{ color: accentColor }} />
              </div>
              <ArrowUpRight className="w-4 h-4 text-gray-700 group-hover:text-gray-500 transition-colors" />
            </div>

            {loading || !stats ? (
              <div className="h-9 w-20 bg-white/5 rounded-lg animate-pulse mb-1" />
            ) : (
              <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
                {format ? format(stats[key]) : stats[key]}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1 font-medium">{label}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Generate Image CTA */}
        <Link
          to="/generate-image"
          className="group relative overflow-hidden rounded-2xl p-5 sm:p-7 border border-cherry/20 hover:border-cherry/40 hover:shadow-[0_0_50px_rgba(196,30,58,0.25)] transition-all duration-300"
          style={{ background: 'linear-gradient(135deg, #C41E3A 0%, #8B0000 100%)' }}
        >
          {/* Shimmer sweep */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/8 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          {/* Sparkle hint */}
          <div className="absolute top-4 right-16 w-1 h-1 rounded-full bg-gold-light opacity-0 group-hover:opacity-100 transition-opacity delay-100" style={{ boxShadow: '0 0 6px #F0CC5A' }} />
          <div className="absolute top-8 right-12 w-0.5 h-0.5 rounded-full bg-white opacity-0 group-hover:opacity-70 transition-opacity delay-200" />

          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4" style={{ color: '#F0CC5A' }} />
                <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: '#F0CC5A' }}>AI Powered</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">Generate Image</h3>
              <p className="text-sm text-white/55">Create stunning product photos instantly</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 group-hover:translate-x-1 transition-all duration-200 flex-shrink-0">
              <ArrowRight className="w-5 h-5 text-white" />
            </div>
          </div>
        </Link>

        {/* Generate Video CTA */}
        <Link
          to="/generate-video"
          className="group relative overflow-hidden bg-[#11111C] rounded-2xl p-5 sm:p-7 border border-white/5 hover:border-purple-500/30 hover:shadow-[0_0_40px_rgba(139,92,246,0.1)] transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-transparent via-purple-900/5 to-violet-900/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/4 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />

          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Play className="w-4 h-4 text-violet-400" />
                <span className="text-xs font-semibold tracking-wide uppercase text-violet-400">Video AI</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">Generate Video</h3>
              <p className="text-sm text-gray-500">Cinematic product videos in seconds</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-violet-500/15 group-hover:translate-x-1 transition-all duration-200 flex-shrink-0">
              <ArrowRight className="w-5 h-5 text-gray-500 group-hover:text-violet-300 transition-colors" />
            </div>
          </div>
        </Link>

        {/* Concept Studio CTA */}
        <Link
          to="/concept-studio"
          className="group relative overflow-hidden bg-[#11111C] rounded-2xl p-5 sm:p-7 border border-white/5 hover:border-teal-500/30 hover:shadow-[0_0_40px_rgba(20,184,166,0.1)] transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-transparent via-teal-900/5 to-cyan-900/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/4 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />

          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-4 h-4 text-teal-400" />
                <span className="text-xs font-semibold tracking-wide uppercase text-teal-400">Packaging Concepts</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">Concept Studio</h3>
              <p className="text-sm text-gray-500">Try new flavors & packaging concepts in seconds</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-teal-500/15 group-hover:translate-x-1 transition-all duration-200 flex-shrink-0">
              <ArrowRight className="w-5 h-5 text-gray-500 group-hover:text-teal-300 transition-colors" />
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Generations */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Recent Generations</h2>
          <Link
            to="/gallery"
            className="text-sm font-medium text-cherry-light hover:text-gold transition-colors flex items-center gap-1 group"
          >
            View all
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[#11111C] rounded-2xl overflow-hidden border border-white/5">
                <div className="aspect-square bg-white/4 animate-pulse" />
              </div>
            ))}
          </div>
        ) : recent && recent.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {recent.map((item) => (
              <div
                key={item.id}
                className="group relative bg-[#11111C] rounded-2xl overflow-hidden border border-white/5 hover:border-white/10 hover:shadow-[0_4px_24px_rgba(0,0,0,0.5)] transition-all duration-300"
              >
                <div
                  className="aspect-square relative"
                  style={{ background: `linear-gradient(135deg, ${item.color}33, ${item.color}11)` }}
                  onMouseEnter={e => { const v = e.currentTarget.querySelector('video'); if (v) v.play(); }}
                  onMouseLeave={e => { const v = e.currentTarget.querySelector('video'); if (v) { v.pause(); v.currentTime = 0.1; } }}
                >
                  {item.url ? (
                    item.type === 'video' ? (
                      <>
                        <video
                          src={item.url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="auto"
                          onLoadedMetadata={e => { e.target.currentTime = 0.1; }}
                          onError={e => {
                            e.target.style.display = 'none';
                            const fallback = e.target.nextSibling;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                        <div className="absolute inset-0 items-center justify-center flex-col gap-2 hidden" style={{ background: `linear-gradient(135deg, ${item.color}22, #000)` }}>
                          <Play className="w-8 h-8 text-white/30" fill="currentColor" />
                          <span className="text-xs text-white/30">Video expired</span>
                        </div>
                      </>
                    ) : (
                      <img src={item.url} alt={item.product} className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="w-16 h-24 rounded-xl shadow-2xl"
                        style={{ background: `linear-gradient(180deg, ${item.color}, ${item.color}CC)` }}
                      />
                    </div>
                  )}

                  {item.type === 'video' && (
                    <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 flex items-center gap-1.5">
                      <Play className="w-3 h-3 text-white" fill="white" />
                      <span className="text-xs text-white font-medium">Video</span>
                    </div>
                  )}

                  {/* Hover overlay with info + download */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3">
                    <p className="text-sm font-semibold text-white leading-tight">{item.product}</p>
                    <p className="text-xs text-white/50 mt-0.5">
                      {new Date(item.date).toLocaleDateString()}
                    </p>
                    {item.url && (
                      <button
                        onClick={(e) => downloadImage(item.url, item.product, e)}
                        className="absolute top-3 right-3 bg-white/15 backdrop-blur-sm rounded-full p-2 hover:bg-cherry/60 transition-colors"
                      >
                        <Download className="w-4 h-4 text-white" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#11111C] backdrop-blur-sm rounded-2xl p-14 border border-white/5 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(196,30,58,0.15), rgba(212,175,55,0.1))' }}>
              <ImageOff className="w-8 h-8 text-gray-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-300">No generations yet</h3>
            <p className="text-sm text-gray-600 mt-1 mb-6">Generate your first image to see it here</p>
            <Link
              to="/generate-image"
              className="bg-gradient-to-r from-cherry to-cherry-dark hover:from-cherry-light hover:to-cherry text-white font-semibold px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(196,30,58,0.3)] hover:shadow-[0_0_30px_rgba(196,30,58,0.4)]"
            >
              <Sparkles className="w-4 h-4" />
              Generate Image
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
