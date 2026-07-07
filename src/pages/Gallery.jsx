import { useState, useEffect } from 'react'
import { Download, Trash2, Play, Image, Video, X, Loader2, ImageOff, Sparkles, AlertTriangle, Clock, Volume2, VolumeX, Users, User } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/apiFetch'
import { useAuth } from '../contexts/AuthContext'

const API_URL = import.meta.env.VITE_API_URL || ''

const tabs = [
  { label: 'All', icon: null },
  { label: 'Images', icon: Image },
  { label: 'Videos', icon: Video },
]

const EMAIL_COLORS = ['#C41E3A', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#6366F1']

function emailColor(email) {
  if (!email) return '#888'
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash)
  return EMAIL_COLORS[Math.abs(hash) % EMAIL_COLORS.length]
}

function emailInitials(email) {
  if (!email) return '?'
  const name = email.split('@')[0]
  const parts = name.split(/[._-]/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export default function Gallery() {
  const { user } = useAuth()
  const [teamMode, setTeamMode] = useState(false)
  const [activeTab, setActiveTab] = useState('All')
  const [filterProduct, setFilterProduct] = useState('All')
  const [expandedItem, setExpandedItem] = useState(null)
  const [generations, setGenerations] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [erroredIds, setErroredIds] = useState(new Set())
  const [modalMuted, setModalMuted] = useState(true)

  const fetchGenerations = (team = teamMode) => {
    const endpoint = team ? `${API_URL}/api/generations/team` : `${API_URL}/api/generations`
    apiFetch(endpoint)
      .then(r => r.json())
      .then(setGenerations)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchGenerations() }, [])

  const handleTeamToggle = (val) => {
    setTeamMode(val)
    setLoading(true)
    setGenerations([])
    fetchGenerations(val)
  }

  const markErrored = (id) => setErroredIds(prev => new Set([...prev, id]))

  const filtered = generations.filter(item => {
    const matchTab = activeTab === 'All' ||
      (activeTab === 'Images' && item.type === 'image') ||
      (activeTab === 'Videos' && item.type === 'video')
    const matchProduct = filterProduct === 'All' || item.product === filterProduct
    return matchTab && matchProduct
  })

  const uniqueProducts = [...new Set(generations.map(g => g.product))]

  const handleDelete = async (id, e) => {
    if (e) e.stopPropagation()
    if (deleteConfirm !== id) { setDeleteConfirm(id); return }
    setDeleteConfirm(null)
    try {
      const res = await apiFetch(`${API_URL}/api/generations/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setGenerations(prev => prev.filter(g => g.id !== id))
        if (expandedItem?.id === id) setExpandedItem(null)
      }
    } catch (err) { console.error(err) }
  }

  const handleDownload = async (url, product, type, e) => {
    if (e) e.stopPropagation()
    const ext = type === 'video' ? 'mp4' : 'png'
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${product}-${Date.now()}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cherry-light animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">{teamMode ? 'Team Gallery' : 'Gallery'}</h1>
          <p className="text-gray-500 mt-1 text-sm">{generations.length} {teamMode ? 'items from everyone' : 'items in your library'}</p>
        </div>
        <div className="flex gap-1.5 bg-[#11111C] rounded-2xl p-1.5 border border-white/5 flex-shrink-0">
          <button
            onClick={() => handleTeamToggle(false)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              !teamMode
                ? 'bg-gradient-to-r from-cherry/25 to-cherry/10 text-white border border-cherry/30 shadow-[0_0_12px_rgba(196,30,58,0.15)]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <User className="w-3.5 h-3.5" /> Mine
          </button>
          <button
            onClick={() => handleTeamToggle(true)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              teamMode
                ? 'bg-gradient-to-r from-violet-500/25 to-violet-500/10 text-white border border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.15)]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Team
          </button>
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="bg-[#11111C] backdrop-blur-sm rounded-2xl p-14 border border-white/5 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(196,30,58,0.15), rgba(212,175,55,0.1))' }}>
            <ImageOff className="w-8 h-8 text-gray-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-300">No generations yet</h3>
          <p className="text-sm text-gray-600 mt-1 mb-6">Generate your first image to see it here</p>
          <Link
            to="/generate-image"
            className="bg-gradient-to-r from-cherry to-cherry-dark hover:from-cherry-light hover:to-cherry text-white font-semibold px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(196,30,58,0.3)]"
          >
            <Sparkles className="w-4 h-4" />
            Generate Image
          </Link>
        </div>
      ) : (
        <>
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="flex gap-1.5 bg-[#11111C] rounded-2xl p-1.5 border border-white/5">
              {tabs.map(tab => (
                <button
                  key={tab.label}
                  onClick={() => setActiveTab(tab.label)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.label
                      ? 'bg-gradient-to-r from-cherry/25 to-cherry/10 text-white border border-cherry/30 shadow-[0_0_12px_rgba(196,30,58,0.15)]'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
                  {tab.label}
                </button>
              ))}
            </div>

            <select
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              className="bg-[#11111C] rounded-xl px-4 py-2.5 text-sm text-white border border-white/5 focus:border-cherry/30 focus:outline-none cursor-pointer"
              style={{ colorScheme: 'dark' }}
            >
              <option value="All">All Products</option>
              {uniqueProducts.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Masonry Grid */}
          <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {filtered.map((item, index) => {
              const heights = ['aspect-square', 'aspect-[3/4]', 'aspect-[4/3]', 'aspect-[3/4]', 'aspect-square']
              const aspectClass = heights[index % heights.length]
              const isVideo = item.type === 'video'
              const isConfirmingDelete = deleteConfirm === item.id
              const isErrored = erroredIds.has(item.id)
              const isOwn = item.user_id === user?.id

              return (
                <div
                  key={item.id}
                  className="group break-inside-avoid bg-[#11111C] rounded-2xl overflow-hidden border border-white/5 transition-all duration-300 cursor-pointer"
                  style={{
                    borderColor: isConfirmingDelete ? 'rgba(239,68,68,0.5)' : undefined,
                  }}
                  onMouseEnter={e => {
                    if (!isConfirmingDelete) {
                      e.currentTarget.style.borderColor = isVideo ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.1)'
                      e.currentTarget.style.boxShadow = isVideo
                        ? '0 8px 32px rgba(139,92,246,0.18)'
                        : '0 8px 32px rgba(0,0,0,0.6)'
                    }
                    if (isVideo) { const v = e.currentTarget.querySelector('video'); if (v) v.play() }
                  }}
                  onMouseLeave={e => {
                    if (!isConfirmingDelete) {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'
                      e.currentTarget.style.boxShadow = 'none'
                    }
                    if (isVideo) { const v = e.currentTarget.querySelector('video'); if (v) { v.pause(); v.currentTime = 0.1 } }
                  }}
                  onClick={() => {
                    if (isConfirmingDelete) { setDeleteConfirm(null); return }
                    setModalMuted(true)
                    setExpandedItem(item)
                  }}
                >
                  <div
                    className={`${aspectClass} relative`}
                    style={{ background: `linear-gradient(135deg, ${item.color}33, ${item.color}11)` }}
                  >
                    {/* Media content */}
                    {item.url && !isErrored ? (
                      isVideo ? (
                        <video
                          src={item.url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="auto"
                          onLoadedMetadata={e => { e.target.currentTime = 0.1 }}
                          onError={() => markErrored(item.id)}
                        />
                      ) : (
                        <img
                          src={item.url}
                          alt={item.product}
                          className="w-full h-full object-cover"
                          onError={() => markErrored(item.id)}
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <Clock className="w-6 h-6 text-gray-600" />
                        <p className="text-xs text-gray-600 text-center px-4 leading-snug">
                          URL expired<br />Regenerate to view
                        </p>
                      </div>
                    )}

                    {/* Video badge */}
                    {isVideo && (
                      <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md rounded-full px-2.5 py-1 flex items-center gap-1.5 border border-violet-500/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                        <span className="text-xs text-violet-300 font-medium">Video</span>
                      </div>
                    )}

                    {/* Hover play indicator for videos */}
                    {isVideo && !isErrored && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                        <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                          <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                        </div>
                      </div>
                    )}

                    {/* Team mode: initials badge (always visible) */}
                    {teamMode && item.user_email && (
                      <div
                        className="absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] border-2 border-black/40 z-10"
                        style={{ background: emailColor(item.user_email) }}
                        title={item.user_email}
                      >
                        {emailInitials(item.user_email)}
                      </div>
                    )}

                    {/* Hover overlay — name + date + actions */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <p className="text-sm font-semibold text-white leading-tight">{item.product}</p>
                        <p className="text-xs text-white/45 mt-0.5">
                          {new Date(item.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>

                      <div className="absolute top-2 right-2 flex gap-1.5">
                        {item.url && !isErrored && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(item.url, item.product, item.type, e) }}
                            className="bg-black/40 backdrop-blur-sm rounded-full p-2 hover:bg-white/20 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5 text-white" />
                          </button>
                        )}
                        {(!teamMode || isOwn) && (
                          isConfirmingDelete ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(item.id, e) }}
                              className="bg-red-500/80 backdrop-blur-sm rounded-full p-2 hover:bg-red-500 transition-colors"
                              title="Confirm delete"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-white" />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(item.id) }}
                              className="bg-black/40 backdrop-blur-sm rounded-full p-2 hover:bg-red-500/50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-white" />
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    {/* Delete confirm border */}
                    {isConfirmingDelete && (
                      <div className="absolute inset-0 border-2 border-red-500/60 rounded-2xl pointer-events-none" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Expanded Modal */}
      {expandedItem && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedItem(null)}
        >
          <div
            className={`bg-[#0D0D14] rounded-2xl border border-white/8 shadow-[0_24px_80px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[90vh] overflow-y-auto ${
              expandedItem.type === 'video'
                ? 'max-w-lg w-full border-violet-500/10'
                : 'max-w-2xl w-full md:flex-row'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {expandedItem.type === 'video' ? (
              /* ── VIDEO MODAL ── */
              <>
                {/* Video Player */}
                <div className="relative bg-black rounded-t-2xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${expandedItem.color}22, #000)` }}>
                  {expandedItem.url && !erroredIds.has(expandedItem.id) ? (
                    <video
                      src={expandedItem.url}
                      className="w-full max-h-[60vh] object-contain"
                      controls
                      autoPlay
                      loop
                      muted={modalMuted}
                      playsInline
                    />
                  ) : (
                    <div className="aspect-[9/16] max-h-[60vh] flex items-center justify-center">
                      <div className="flex flex-col items-center gap-3 text-gray-600">
                        <Clock className="w-10 h-10" />
                        <p className="text-sm">Video unavailable</p>
                      </div>
                    </div>
                  )}

                  {/* Close button */}
                  <button
                    onClick={() => setExpandedItem(null)}
                    className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full p-2 transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-300" />
                  </button>

                  {/* Mute toggle */}
                  {expandedItem.url && !erroredIds.has(expandedItem.id) && (
                    <button
                      onClick={() => setModalMuted(m => !m)}
                      className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full p-2 transition-colors"
                    >
                      {modalMuted
                        ? <VolumeX className="w-4 h-4 text-gray-300" />
                        : <Volume2 className="w-4 h-4 text-violet-300" />
                      }
                    </button>
                  )}
                </div>

                {/* Info panel below video */}
                <div className="p-5 flex flex-col gap-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-white">{expandedItem.product}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(expandedItem.date).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-violet-500/10 text-violet-400 border-violet-500/20 flex-shrink-0">
                      Video
                    </span>
                  </div>

                  {expandedItem.scene && expandedItem.scene.length > 4 && (
                    <div className="bg-white/4 rounded-xl p-3.5 max-h-28 overflow-y-auto">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Scene</p>
                      <p className="text-xs text-gray-400 leading-relaxed">{expandedItem.scene}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {expandedItem.url && !erroredIds.has(expandedItem.id) && (
                      <button
                        onClick={() => handleDownload(expandedItem.url, expandedItem.product, 'video')}
                        className="flex-1 bg-gradient-to-r from-violet-600 to-violet-800 hover:from-violet-500 hover:to-violet-700 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_16px_rgba(139,92,246,0.25)]"
                      >
                        <Download className="w-4 h-4" /> Download MP4
                      </button>
                    )}
                    {deleteConfirm === expandedItem.id ? (
                      <button
                        onClick={() => handleDelete(expandedItem.id)}
                        className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 font-medium"
                      >
                        <AlertTriangle className="w-4 h-4" /> Confirm
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(expandedItem.id)}
                        className="bg-white/5 hover:bg-red-500/15 text-gray-500 hover:text-red-400 px-4 py-2.5 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* ── IMAGE MODAL ── */
              <>
                <div
                  className="md:w-1/2 aspect-square relative flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${expandedItem.color}44, ${expandedItem.color}11)` }}
                >
                  {expandedItem.url && !erroredIds.has(expandedItem.id) ? (
                    <img
                      src={expandedItem.url}
                      alt={expandedItem.product}
                      className="w-full h-full object-cover"
                      onError={() => markErrored(expandedItem.id)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-600">
                      <Clock className="w-10 h-10" />
                      <p className="text-sm">Image unavailable</p>
                    </div>
                  )}

                  {/* Close on mobile */}
                  <button
                    onClick={() => setExpandedItem(null)}
                    className="absolute top-3 right-3 md:hidden bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-full p-2 transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-300" />
                  </button>
                </div>

                <div className="flex-1 p-6 flex flex-col">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-white">{expandedItem.product}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {new Date(expandedItem.date).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <button
                      onClick={() => setExpandedItem(null)}
                      className="hidden md:flex bg-white/5 hover:bg-white/10 rounded-xl p-2 transition-colors flex-shrink-0"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>

                  <div className="mb-4">
                    <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-cherry/10 text-cherry-light border-cherry/20">
                      Image
                    </span>
                  </div>

                  {expandedItem.prompt && (
                    <div className="bg-white/4 rounded-xl p-4 mb-4 flex-1 max-h-32 overflow-y-auto">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Prompt</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{expandedItem.prompt}</p>
                    </div>
                  )}

                  <div className="flex gap-3 mt-auto">
                    {expandedItem.url && !erroredIds.has(expandedItem.id) && (
                      <button
                        onClick={() => handleDownload(expandedItem.url, expandedItem.product, 'image')}
                        className="flex-1 bg-gradient-to-r from-cherry to-cherry-dark hover:from-cherry-light hover:to-cherry text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_16px_rgba(196,30,58,0.25)]"
                      >
                        <Download className="w-4 h-4" /> Download
                      </button>
                    )}
                    {deleteConfirm === expandedItem.id ? (
                      <button
                        onClick={() => handleDelete(expandedItem.id)}
                        className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 font-medium"
                      >
                        <AlertTriangle className="w-4 h-4" /> Confirm
                      </button>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(expandedItem.id)}
                        className="bg-white/5 hover:bg-red-500/15 text-gray-500 hover:text-red-400 px-4 py-2.5 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dismiss delete confirm */}
      {deleteConfirm && !expandedItem && (
        <div className="fixed inset-0 z-30" onClick={() => setDeleteConfirm(null)} />
      )}
    </div>
  )
}
