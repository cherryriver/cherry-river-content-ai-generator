import { useState, useEffect } from 'react'
import { Search, Check, Sparkles, Download, RotateCcw, Loader2, AlertCircle, Package, Plus, X, Layers, Clapperboard, Palette, ChevronLeft, Wand2, LayoutGrid, Image as ImageIcon, RefreshCw, Save } from 'lucide-react'
import { apiFetch } from '../lib/apiFetch'

const API_URL = import.meta.env.VITE_API_URL || ''
const CUSTOM_PRESETS_KEY = 'conceptCustomPresets'

const formatOptions = [
  { id: 'can', label: '355mL Can', desc: 'RTD cocktails & mocktails' },
  { id: 'bottle750', label: '750mL Bottle', desc: 'Cherry River spirits' },
  { id: 'bottle114', label: '1.14L Bottle', desc: 'Averse premium format' },
]

function getProductFormat(p) {
  if (p.productType === 'can') return 'can'
  const n = (p.name || '').toLowerCase()
  if (n.includes('averse') || n.includes('1.14')) return 'bottle114'
  return 'bottle750'
}

function loadCustomPresets() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) || '[]') } catch { return [] }
}

async function compressImage(file, maxPx = 1920, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      )
    }
    img.src = URL.createObjectURL(file)
  })
}

export default function ConceptStudio() {
  const [step, setStep] = useState(1)
  const [products, setProducts] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [finishes, setFinishes] = useState([])
  const [moods, setMoods] = useState([])
  const [capColors, setCapColors] = useState([])
  const [liquidOptions, setLiquidOptions] = useState([])
  const [examples, setExamples] = useState([])
  const [customPresets, setCustomPresets] = useState(loadCustomPresets)

  const [format, setFormat] = useState(null)
  const [scenes, setScenes] = useState([])
  const [loadingScenes, setLoadingScenes] = useState(false)
  const [sceneId, setSceneId] = useState(null)
  const [sceneMode, setSceneMode] = useState('preset')
  const [customScene, setCustomScene] = useState('')
  const [outputMode, setOutputMode] = useState('single')

  const [flavors, setFlavors] = useState([])
  const [flavorTab, setFlavorTab] = useState('catalog')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [newFlavorName, setNewFlavorName] = useState('')
  const [newFlavorImagePreview, setNewFlavorImagePreview] = useState(null)
  const [newFlavorImageUrl, setNewFlavorImageUrl] = useState(null)
  const [uploadingNewFlavorImage, setUploadingNewFlavorImage] = useState(false)
  const [newFlavorImageError, setNewFlavorImageError] = useState(null)

  const [styleMode, setStyleMode] = useState('preset')
  const [exampleId, setExampleId] = useState(null)
  const [finish, setFinish] = useState(null)
  const [mood, setMood] = useState(null)
  const [capColor, setCapColor] = useState('matches_body')
  const [liquidVisibility, setLiquidVisibility] = useState('visible')
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetNameInput, setPresetNameInput] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [singleResult, setSingleResult] = useState(null)
  const [batchResults, setBatchResults] = useState(null)
  const [boardResults, setBoardResults] = useState(null)
  // The master board tile resolves the real product's dominant color (extracted from its photo);
  // every other tile — including retries — must reuse THAT value, not the catalog's raw stored
  // color, or the "brand color" instruction contradicts the "match the reference image" instruction
  // and Flux inconsistently obeys one or the other (this was the root cause of the green-patch bug).
  const [boardColorHex, setBoardColorHex] = useState(null)
  const [retryingKeys, setRetryingKeys] = useState(new Set())

  const isBottle = format === 'bottle750' || format === 'bottle114'

  useEffect(() => {
    apiFetch(`${API_URL}/api/products`).then(r => r.json()).then(setProducts).catch(console.error).finally(() => setLoadingData(false))
    apiFetch(`${API_URL}/api/concept-options`).then(r => r.json()).then(d => {
      setFinishes(d.finishes); setMoods(d.moods); setCapColors(d.capColors || []); setLiquidOptions(d.liquidVisibility || [])
    }).catch(console.error)
    apiFetch(`${API_URL}/api/concept-examples`).then(r => r.json()).then(setExamples).catch(console.error)
  }, [])

  useEffect(() => {
    if (!format) return
    setLoadingScenes(true)
    setSceneId(null)
    apiFetch(`${API_URL}/api/concept-scenes?format=${format}`)
      .then(r => r.json()).then(setScenes).catch(console.error).finally(() => setLoadingScenes(false))
  }, [format])

  const catalogProducts = products.filter(p => p.status === 'ready' && getProductFormat(p) === format)
  const filteredCatalog = catalogProducts.filter(p => p.name.toLowerCase().includes(catalogSearch.toLowerCase()))

  const addFlavor = (flavor) => {
    setFlavors(prev => prev.length >= 12 ? prev : [...prev, { ...flavor, localId: Date.now() + Math.random() }])
  }
  const removeFlavor = (localId) => setFlavors(prev => prev.filter(f => f.localId !== localId))

  const handleAddCatalogFlavor = (product) => {
    if (flavors.some(f => f.flavorName === product.name)) return
    addFlavor({ flavorName: product.name, colorHex: product.color, productImage: product.image, source: 'catalog' })
  }
  const handleAddNewFlavor = () => {
    if (!newFlavorName.trim()) return
    addFlavor({ flavorName: newFlavorName.trim(), colorHex: null, productImage: newFlavorImageUrl, source: 'custom' })
    setNewFlavorName(''); setNewFlavorImagePreview(null); setNewFlavorImageUrl(null); setNewFlavorImageError(null)
  }

  const handleNewFlavorImageChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setNewFlavorImagePreview(URL.createObjectURL(file))
    setNewFlavorImageUrl(null); setNewFlavorImageError(null); setUploadingNewFlavorImage(true)
    try {
      const compressed = await compressImage(file)
      const fd = new FormData()
      fd.append('image', compressed)
      const res = await apiFetch(`${API_URL}/api/upload-reference`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setNewFlavorImageUrl(data.url)
    } catch (err) {
      setNewFlavorImageError(err.message)
    } finally {
      setUploadingNewFlavorImage(false)
    }
  }

  const handleRemoveNewFlavorImage = () => {
    setNewFlavorImagePreview(null); setNewFlavorImageUrl(null); setNewFlavorImageError(null)
  }

  const styleReady = (styleMode === 'preset' && exampleId) || (styleMode === 'custom' && finish && mood)

  const goToStep = (s) => {
    if (s === 2 && !format) return
    if (s === 3 && flavors.length === 0) return
    if (s === 4 && !styleReady) return
    setStep(s)
  }

  const handleReset = () => {
    setStep(1); setFormat(null); setSceneId(null); setSceneMode('preset'); setCustomScene(''); setFlavors([]); setOutputMode('single')
    setStyleMode('preset'); setExampleId(null); setFinish(null); setMood(null)
    setCapColor('matches_body'); setLiquidVisibility('visible'); setCustomPrompt('')
    setSingleResult(null); setBatchResults(null); setBoardResults(null); setBoardColorHex(null); setError(null)
    setNewFlavorImagePreview(null); setNewFlavorImageUrl(null); setNewFlavorImageError(null)
  }

  const handleDownload = async (url, name) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${name || 'concept'}-${Date.now()}.png`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch { window.open(url, '_blank') }
  }

  const styleBody = () => {
    const base = exampleId ? { exampleId } : { finish, mood, customPrompt: customPrompt.trim() || undefined }
    return isBottle ? { ...base, capColor, liquidVisibility } : base
  }

  const handleSaveCustomPreset = () => {
    if (!presetNameInput.trim() || !finish || !mood) return
    const preset = { id: `custom-${Date.now()}`, name: presetNameInput.trim(), finish, mood, customPrompt: customPrompt.trim() || undefined, custom: true }
    const next = [...customPresets, preset]
    setCustomPresets(next)
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next))
    setPresetNameInput(''); setSavingPreset(false)
  }
  const handleDeleteCustomPreset = (id) => {
    const next = customPresets.filter(p => p.id !== id)
    setCustomPresets(next)
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next))
  }
  const handlePickCustomPreset = (preset) => {
    setFinish(preset.finish); setMood(preset.mood); setCustomPrompt(preset.customPrompt || ''); setExampleId(null); setStep(4)
  }

  const handleGenerate = async () => {
    setError(null); setSingleResult(null); setBatchResults(null); setBoardResults(null); setGenerating(true)
    try {
      if (flavors.length > 1) {
        const response = await apiFetch(`${API_URL}/api/generate-concept-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flavors: flavors.map(f => ({ flavorName: f.flavorName, colorHex: f.colorHex, productImage: f.productImage })), format, sceneId: sceneMode === 'custom' ? undefined : sceneId, customScene: sceneMode === 'custom' ? customScene.trim() : undefined, ...styleBody() }),
        })
        const data = await response.json()
        if (!response.ok || !data.success) throw new Error(data.error || 'Batch generation failed')
        setBatchResults(data.results)
      } else if (outputMode === 'board') {
        const response = await apiFetch(`${API_URL}/api/generate-concept-board`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flavorName: flavors[0].flavorName, colorHex: flavors[0].colorHex, format, productImageUrl: flavors[0].productImage, ...styleBody() }),
        })
        const data = await response.json()
        if (!response.ok || !data.success) throw new Error(data.error || 'Board generation failed')
        setBoardResults(data.results)
        setBoardColorHex(data.resolvedColorHex || null)
      } else {
        const response = await apiFetch(`${API_URL}/api/generate-concept-scene`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flavorName: flavors[0].flavorName, colorHex: flavors[0].colorHex, format, sceneId: sceneMode === 'custom' ? undefined : sceneId, customScene: sceneMode === 'custom' ? customScene.trim() : undefined, productImageUrl: flavors[0].productImage, ...styleBody() }),
        })
        const data = await response.json()
        if (!response.ok || !data.success) throw new Error(data.error || 'Generation failed')
        setSingleResult({ image: data.image, enhancedPrompt: data.enhancedPrompt })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const retryBatchItem = async (flavorName) => {
    const key = `batch-${flavorName}`
    setRetryingKeys(prev => new Set(prev).add(key))
    try {
      const flavor = flavors.find(f => f.flavorName === flavorName)
      const response = await apiFetch(`${API_URL}/api/generate-concept-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flavorName, colorHex: flavor?.colorHex, format, sceneId: sceneMode === 'custom' ? undefined : sceneId, customScene: sceneMode === 'custom' ? customScene.trim() : undefined, productImageUrl: flavor?.productImage, ...styleBody() }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Retry failed')
      setBatchResults(prev => prev.map(r => r.flavorName === flavorName ? { flavorName, success: true, image: data.image, enhancedPrompt: data.enhancedPrompt } : r))
    } catch (err) {
      setBatchResults(prev => prev.map(r => r.flavorName === flavorName ? { ...r, error: err.message } : r))
    } finally {
      setRetryingKeys(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  const retryBoardItem = async (sceneIdToRetry, sceneName) => {
    const key = `board-${sceneIdToRetry}`
    setRetryingKeys(prev => new Set(prev).add(key))
    try {
      const masterTile = boardResults?.find(r => r.sceneId !== sceneIdToRetry && r.success)
      const response = await apiFetch(`${API_URL}/api/generate-concept-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flavorName: flavors[0].flavorName, colorHex: boardColorHex || flavors[0].colorHex, format, sceneId: sceneIdToRetry, referenceImageUrl: masterTile?.image, productImageUrl: flavors[0].productImage, ...styleBody() }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Retry failed')
      setBoardResults(prev => prev.map(r => r.sceneId === sceneIdToRetry ? { sceneId: sceneIdToRetry, sceneName, success: true, image: data.image, enhancedPrompt: data.enhancedPrompt } : r))
    } catch (err) {
      setBoardResults(prev => prev.map(r => r.sceneId === sceneIdToRetry ? { ...r, error: err.message } : r))
    } finally {
      setRetryingKeys(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  const sceneReady = outputMode === 'board' || (sceneMode === 'custom' ? customScene.trim().length > 0 : !!sceneId)
  const canGenerate = flavors.length > 0 && styleReady && sceneReady
  const selectedScene = scenes.find(s => s.id === sceneId)
  const selectedExample = examples.find(e => e.id === exampleId) || customPresets.find(e => e.id === exampleId)

  if (loadingData) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-teal-400 animate-spin" /></div>
  }

  const steps = [{ n: 1, label: 'Format' }, { n: 2, label: 'Flavors' }, { n: 3, label: 'Style' }, { n: 4, label: 'Scene' }]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Concept Studio</h1>
        <p className="text-gray-400 mt-1">Packaging concept mockups for design brainstorming — shape, finish & scene only, labels stay vector</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {steps.map((s, i) => (
          <button key={s.n} onClick={() => goToStep(s.n)} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
              step === s.n ? 'bg-teal-500 text-white shadow-[0_0_20px_rgba(20,184,166,0.4)]' :
              step > s.n ? 'bg-teal-500/20 text-teal-300' : 'bg-white/5 text-gray-500'
            }`}>
              {step > s.n ? <Check className="w-4 h-4" /> : s.n}
            </div>
            <span className={`text-sm hidden sm:inline ${step === s.n ? 'text-white font-medium' : 'text-gray-500'}`}>{s.label}</span>
            {i < steps.length - 1 && <div className={`w-8 h-px mx-1 ${step > s.n ? 'bg-teal-500/40' : 'bg-border'}`} />}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {step === 1 && (
            <div className="bg-card/60 rounded-2xl p-6 border border-border/50 space-y-4">
              <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-teal-400" /><h3 className="text-lg font-semibold text-white">Choose Format</h3></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {formatOptions.map(f => (
                  <button key={f.id} onClick={() => { setFormat(f.id); setStep(2) }} className={`flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-all ${format === f.id ? 'border-teal-500/50 bg-teal-500/10 shadow-[0_0_15px_rgba(20,184,166,0.15)]' : 'border-border bg-dark hover:border-white/15'}`}>
                    <span className="text-sm font-semibold text-white">{f.label}</span>
                    <span className="text-xs text-gray-500">{f.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="bg-card/60 rounded-2xl p-6 border border-border/50 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Package className="w-4 h-4 text-teal-400" /><h3 className="text-lg font-semibold text-white">Pick Flavors</h3></div>
                <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5" /> Format</button>
              </div>
              <p className="text-xs text-gray-500">Add one flavor for a single concept (full 8-angle board available), or several for a collection batch — pick from your catalog or try a brand-new flavor idea.</p>

              {flavors.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {flavors.map(f => (
                    <div key={f.localId} className="flex items-center gap-2 bg-teal-500/10 border border-teal-500/20 rounded-xl px-3 py-2">
                      {f.colorHex && <div className="w-3 h-3 rounded-full" style={{ background: f.colorHex }} />}
                      <span className="text-xs text-teal-300 font-medium max-w-[140px] truncate">{f.flavorName}</span>
                      <button onClick={() => removeFlavor(f.localId)} className="text-teal-400 hover:text-teal-200"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-1.5 bg-dark rounded-xl p-1.5 border border-white/5 w-fit">
                <button onClick={() => setFlavorTab('catalog')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${flavorTab === 'catalog' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}>From Catalog</button>
                <button onClick={() => setFlavorTab('new')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${flavorTab === 'new' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}>New Flavor Idea</button>
              </div>

              {flavorTab === 'catalog' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input type="text" placeholder="Search products..." value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} className="w-full bg-dark rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 border border-border focus:border-teal-500/40 focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
                    {filteredCatalog.map(product => {
                      const isAdded = flavors.some(f => f.flavorName === product.name)
                      return (
                        <button key={product.id} onClick={() => handleAddCatalogFlavor(product)} disabled={isAdded} className={`relative rounded-xl border p-2 flex flex-col items-center gap-1.5 transition-all ${isAdded ? 'border-teal-500/50 bg-teal-500/10 opacity-60' : 'border-white/5 bg-dark hover:border-white/15'}`}>
                          {product.image ? <img src={product.image} alt={product.name} className="w-full aspect-square rounded-lg object-contain p-1" /> : <div className="w-full aspect-square rounded-lg" style={{ background: product.color }} />}
                          <span className="text-[10px] text-gray-400 text-center leading-tight line-clamp-2 w-full">{product.name}</span>
                          {isAdded && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center"><Check className="w-3 h-3 text-white" /></div>}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="text" placeholder="e.g. Mango Chili, Blood Orange Smoke..." value={newFlavorName} onChange={(e) => setNewFlavorName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddNewFlavor()} className="flex-1 bg-dark rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 border border-border focus:border-teal-500/40 focus:outline-none" />
                    <button onClick={handleAddNewFlavor} disabled={!newFlavorName.trim() || uploadingNewFlavorImage} className="bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white rounded-xl px-4 py-2.5 flex items-center gap-1.5 text-sm font-medium transition-colors"><Plus className="w-4 h-4" /> Add</button>
                  </div>

                  <p className="text-xs text-gray-500">Optional: upload a reference photo (e.g. a similar bottle/can) so the mockup matches its exact shape instead of a generic stand-in.</p>

                  {newFlavorImagePreview ? (
                    <div className="flex items-center gap-3 bg-dark rounded-xl border border-white/5 p-2">
                      <img src={newFlavorImagePreview} alt="Reference" className="w-12 h-12 rounded-lg object-contain bg-black/20" />
                      <div className="flex-1 text-xs text-gray-400">
                        {uploadingNewFlavorImage ? (
                          <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading...</span>
                        ) : newFlavorImageError ? (
                          <span className="text-red-400">{newFlavorImageError}</span>
                        ) : newFlavorImageUrl ? (
                          <span className="text-teal-400">Reference photo ready</span>
                        ) : null}
                      </div>
                      <button onClick={handleRemoveNewFlavorImage} className="text-gray-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 border border-dashed border-white/10 hover:border-white/20 rounded-xl px-4 py-2.5 text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors">
                      <ImageIcon className="w-3.5 h-3.5" /> Upload reference photo (optional)
                      <input type="file" accept="image/*" className="hidden" onChange={handleNewFlavorImageChange} />
                    </label>
                  )}
                </div>
              )}

              <button onClick={() => setStep(3)} disabled={flavors.length === 0} className="w-full bg-gradient-to-r from-teal-600 to-teal-800 hover:from-teal-500 hover:to-teal-700 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-40">
                Continue with {flavors.length} flavor{flavors.length !== 1 ? 's' : ''}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="bg-card/60 rounded-2xl p-6 border border-border/50 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Palette className="w-4 h-4 text-teal-400" /><h3 className="text-lg font-semibold text-white">Choose Style</h3></div>
                <button onClick={() => setStep(2)} className="text-sm text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5" /> Flavors</button>
              </div>

              <div className="flex gap-1.5 bg-dark rounded-xl p-1.5 border border-white/5 w-fit">
                <button onClick={() => setStyleMode('preset')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${styleMode === 'preset' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}>Quick Presets</button>
                <button onClick={() => setStyleMode('custom')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${styleMode === 'custom' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}>Custom</button>
              </div>

              {styleMode === 'preset' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto pr-1">
                  {examples.map(ex => (
                    <button key={ex.id} onClick={() => { setExampleId(ex.id); setStep(4) }} className={`p-3 rounded-xl border text-left transition-all ${exampleId === ex.id ? 'border-teal-500/50 bg-teal-500/10' : 'border-border bg-dark hover:border-white/15'}`}>
                      <span className="text-xs font-medium text-white">{ex.name}</span>
                    </button>
                  ))}
                  {customPresets.map(ex => (
                    <div key={ex.id} className={`relative p-3 rounded-xl border text-left transition-all ${exampleId === ex.id ? 'border-teal-500/50 bg-teal-500/10' : 'border-amber-500/20 bg-dark hover:border-amber-500/40'}`}>
                      <button onClick={() => handlePickCustomPreset(ex)} className="text-left w-full pr-4">
                        <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-wider block mb-0.5">Custom</span>
                        <span className="text-xs font-medium text-white">{ex.name}</span>
                      </button>
                      <button onClick={() => handleDeleteCustomPreset(ex.id)} className="absolute top-2 right-2 text-gray-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-2">Finish</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {finishes.map(f => (
                        <button key={f.id} onClick={() => { setFinish(f.id); setExampleId(null) }} className={`px-3 py-2.5 rounded-xl text-sm font-medium border capitalize transition-all ${finish === f.id ? 'border-teal-500/50 bg-teal-500/10 text-white' : 'border-border bg-dark text-gray-500 hover:text-gray-300'}`}>{f.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-2">Mood</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {moods.map(m => (
                        <button key={m.id} onClick={() => { setMood(m.id); setExampleId(null) }} className={`px-3 py-2.5 rounded-xl text-sm font-medium border capitalize transition-all ${mood === m.id ? 'border-teal-500/50 bg-teal-500/10 text-white' : 'border-border bg-dark text-gray-500 hover:text-gray-300'}`}>{m.label}</button>
                      ))}
                    </div>
                  </div>

                  {isBottle && (
                    <>
                      <div>
                        <p className="text-sm font-medium text-gray-400 mb-2">Cap Color</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {capColors.map(c => (
                            <button key={c.id} onClick={() => setCapColor(c.id)} className={`px-3 py-2 rounded-xl text-sm font-medium border capitalize transition-all ${capColor === c.id ? 'border-teal-500/50 bg-teal-500/10 text-white' : 'border-border bg-dark text-gray-500 hover:text-gray-300'}`}>{c.label}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-400 mb-2">Liquid Visibility</p>
                        <div className="grid grid-cols-2 gap-2">
                          {liquidOptions.map(l => (
                            <button key={l.id} onClick={() => setLiquidVisibility(l.id)} className={`px-3 py-2 rounded-xl text-sm font-medium border capitalize transition-all ${liquidVisibility === l.id ? 'border-teal-500/50 bg-teal-500/10 text-white' : 'border-border bg-dark text-gray-500 hover:text-gray-300'}`}>{l.label}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-2">Custom Prompt <span className="text-gray-600 font-normal">(optional)</span></p>
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      maxLength={300}
                      rows={3}
                      placeholder="Describe anything the presets above don't cover — e.g. gold foil wave pattern, embossed ridges, retro 70s vibe, marble backdrop..."
                      className="w-full bg-dark rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 border border-border focus:border-teal-500/40 focus:outline-none resize-none"
                    />
                    <p className="text-[11px] text-gray-600 mt-1">{customPrompt.length}/300 — added on top of the Finish/Mood picks above.</p>
                  </div>

                  {finish && mood && (
                    savingPreset ? (
                      <div className="flex gap-2">
                        <input type="text" placeholder="Preset name..." value={presetNameInput} onChange={(e) => setPresetNameInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveCustomPreset()} className="flex-1 bg-dark rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 border border-border focus:border-amber-500/40 focus:outline-none" />
                        <button onClick={handleSaveCustomPreset} disabled={!presetNameInput.trim()} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors">Save</button>
                        <button onClick={() => setSavingPreset(false)} className="text-gray-500 hover:text-white px-2"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => setSavingPreset(true)} className="text-sm text-amber-400 hover:text-amber-300 flex items-center gap-1.5"><Save className="w-3.5 h-3.5" /> Save this combo as a reusable preset</button>
                    )
                  )}

                  <button onClick={() => setStep(4)} disabled={!finish || !mood} className="w-full bg-gradient-to-r from-teal-600 to-teal-800 hover:from-teal-500 hover:to-teal-700 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-40">Continue</button>
                </div>
              )}
            </div>
          )}

          {step === 4 && !singleResult && !batchResults && !boardResults && !generating && (
            <div className="bg-card/60 rounded-2xl p-6 border border-border/50 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Clapperboard className="w-4 h-4 text-teal-400" /><h3 className="text-lg font-semibold text-white">Choose Scene</h3></div>
                <button onClick={() => setStep(3)} className="text-sm text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5" /> Style</button>
              </div>

              {flavors.length === 1 && (
                <div className="flex gap-1.5 bg-dark rounded-xl p-1.5 border border-white/5 w-fit">
                  <button onClick={() => setOutputMode('single')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${outputMode === 'single' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}><ImageIcon className="w-3.5 h-3.5" /> Single Scene</button>
                  <button onClick={() => setOutputMode('board')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${outputMode === 'board' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}><LayoutGrid className="w-3.5 h-3.5" /> Full Board (8 angles)</button>
                </div>
              )}

              {outputMode === 'board' && flavors.length === 1 ? (
                <p className="text-xs text-gray-500">Generates all 8 packaging angles for this flavor in one go — studio, lifestyle, shelf, hero, hands, {format === 'can' ? 'cooler' : 'ice bucket'}, bar, event.</p>
              ) : (
                <>
                  <div className="flex gap-1.5 bg-dark rounded-xl p-1.5 border border-white/5 w-fit">
                    <button onClick={() => setSceneMode('preset')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${sceneMode === 'preset' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}>Preset Scenes</button>
                    <button onClick={() => setSceneMode('custom')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${sceneMode === 'custom' ? 'bg-teal-500/20 text-white border border-teal-500/30' : 'text-gray-500 hover:text-gray-300'}`}>Custom Scene</button>
                  </div>

                  {sceneMode === 'custom' ? (
                    <div>
                      <textarea
                        value={customScene}
                        onChange={(e) => setCustomScene(e.target.value)}
                        maxLength={400}
                        rows={4}
                        placeholder="Describe the scene — e.g. floating on dark water at night under a single moonlit spotlight, mist rolling across the surface, distant city lights blurred in the background..."
                        className="w-full bg-dark rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 border border-border focus:border-teal-500/40 focus:outline-none resize-none"
                      />
                      <p className="text-[11px] text-gray-600 mt-1">{customScene.length}/400 — replaces the preset scene entirely.</p>
                    </div>
                  ) : loadingScenes ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-teal-400 animate-spin" /></div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {scenes.map(s => (
                        <button key={s.id} onClick={() => setSceneId(s.id)} className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all ${sceneId === s.id ? 'border-teal-500/50 bg-teal-500/10' : 'border-border bg-dark hover:border-white/15'}`}>
                          <span className="text-sm font-semibold text-white">{s.name}</span>
                          <span className="text-[11px] text-gray-500 leading-snug">{s.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {error && (
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                  <div><p className="text-sm font-medium text-red-400">Generation failed</p><p className="text-xs text-red-400/70 mt-0.5">{error}</p></div>
                </div>
              )}

              <button onClick={handleGenerate} disabled={!canGenerate} className="w-full bg-gradient-to-r from-teal-600 to-teal-800 hover:from-teal-500 hover:to-teal-700 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_30px_rgba(20,184,166,0.25)] disabled:opacity-40 disabled:cursor-not-allowed">
                <Sparkles className="w-5 h-5" />
                {!canGenerate ? 'Choose a scene' : outputMode === 'board' && flavors.length === 1 ? 'Generate Full Board (8 images)' : flavors.length > 1 ? `Generate ${flavors.length} Concepts` : 'Generate Concept'}
              </button>
            </div>
          )}

          {generating && (
            <div className="bg-[#11111C] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-full border-4 border-teal-500/20 border-t-teal-500 animate-spin" />
              <div className="text-center">
                <p className="text-base font-semibold text-white">Generating {outputMode === 'board' ? '8 concept angles' : flavors.length > 1 ? `${flavors.length} concept mockups` : 'your concept mockup'}...</p>
                <p className="text-sm text-gray-500 mt-1">This may take {(flavors.length > 1 || outputMode === 'board') ? '1-2 minutes' : '10–30 seconds'}</p>
              </div>
            </div>
          )}

          {singleResult && (
            <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-6 border border-border/50 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Concept Mockup</h3>
                <button onClick={handleReset} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"><RotateCcw className="w-4 h-4" /> Start Over</button>
              </div>
              {singleResult.enhancedPrompt && (
                <div className="bg-[#0D0D14] rounded-xl p-4 border border-teal-500/20">
                  <div className="flex items-center gap-2 mb-2"><Wand2 className="w-3.5 h-3.5 text-teal-400" /><span className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Claude Concept Brief</span></div>
                  <p className="text-xs text-gray-400 leading-relaxed">{singleResult.enhancedPrompt}</p>
                </div>
              )}
              <div className="relative rounded-xl overflow-hidden group">
                <img src={singleResult.image} alt="Concept mockup" className="w-full object-cover rounded-xl" />
                <button onClick={() => handleDownload(singleResult.image, flavors[0]?.flavorName)} className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-2 hover:bg-black/80"><Download className="w-4 h-4 text-white" /></button>
              </div>
              <button onClick={() => handleDownload(singleResult.image, flavors[0]?.flavorName)} className="w-full bg-gradient-to-r from-teal-600 to-teal-800 hover:from-teal-500 hover:to-teal-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"><Download className="w-4 h-4" /> Download PNG</button>
            </div>
          )}

          {boardResults && (
            <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-6 border border-border/50 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Concept Board ({boardResults.filter(r => r.success).length}/{boardResults.length})</h3>
                <button onClick={handleReset} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"><RotateCcw className="w-4 h-4" /> Start Over</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {boardResults.map((r) => {
                  const key = `board-${r.sceneId}`
                  const isRetrying = retryingKeys.has(key)
                  return (
                    <div key={r.sceneId} className="rounded-xl overflow-hidden border border-border/50">
                      {r.success ? (
                        <div className="relative group">
                          <img src={r.image} alt={r.sceneName} className="w-full aspect-[4/5] object-cover" />
                          <button onClick={() => handleDownload(r.image, `${flavors[0]?.flavorName}-${r.sceneName}`)} className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-1.5 hover:bg-black/80"><Download className="w-3.5 h-3.5 text-white" /></button>
                          <p className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] text-white truncate">{r.sceneName}</p>
                        </div>
                      ) : (
                        <div className="aspect-[4/5] flex flex-col items-center justify-center gap-1.5 bg-red-500/5 p-2">
                          <AlertCircle className="w-5 h-5 text-red-400" />
                          <p className="text-[10px] text-red-400 text-center">{r.sceneName}</p>
                          <button onClick={() => retryBoardItem(r.sceneId, r.sceneName)} disabled={isRetrying} className="flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 disabled:opacity-50">
                            {isRetrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {batchResults && (
            <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-6 border border-border/50 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Collection Results ({batchResults.filter(r => r.success).length}/{batchResults.length})</h3>
                <button onClick={handleReset} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"><RotateCcw className="w-4 h-4" /> Start Over</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {batchResults.map((r) => {
                  const key = `batch-${r.flavorName}`
                  const isRetrying = retryingKeys.has(key)
                  return (
                    <div key={r.flavorName} className="rounded-xl overflow-hidden border border-border/50">
                      {r.success ? (
                        <div className="relative group">
                          <img src={r.image} alt={r.flavorName} className="w-full aspect-[4/5] object-cover" />
                          <button onClick={() => handleDownload(r.image, r.flavorName)} className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-1.5 hover:bg-black/80"><Download className="w-3.5 h-3.5 text-white" /></button>
                          <p className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] text-white truncate">{r.flavorName}</p>
                        </div>
                      ) : (
                        <div className="aspect-[4/5] flex flex-col items-center justify-center gap-1.5 bg-red-500/5 p-2">
                          <AlertCircle className="w-5 h-5 text-red-400" />
                          <p className="text-[10px] text-red-400 text-center">{r.flavorName}</p>
                          <p className="text-[9px] text-red-400/70 text-center">{r.error || 'Failed'}</p>
                          <button onClick={() => retryBatchItem(r.flavorName)} disabled={isRetrying} className="flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 disabled:opacity-50">
                            {isRetrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Summary */}
        <div className="space-y-4">
          <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-5 border border-border/50 space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Summary</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Format</span><span className="text-sm text-white">{formatOptions.find(f => f.id === format)?.label || <span className="text-gray-600">Not selected</span>}</span></div>
              <div className="h-px bg-border" />
              <div><span className="text-sm text-gray-500">Flavors</span><p className="text-sm text-white mt-1">{flavors.length > 0 ? flavors.map(f => f.flavorName).join(', ') : <span className="text-gray-600">None added</span>}</p></div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Style</span><span className="text-sm text-white truncate ml-4 max-w-[140px]">{styleMode === 'preset' ? (selectedExample?.name || <span className="text-gray-600">Not selected</span>) : (finish && mood ? `${finish} / ${mood}` : <span className="text-gray-600">Not selected</span>)}</span></div>
              {isBottle && (finish || exampleId) && (
                <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Cap / Liquid</span><span className="text-sm text-white">{capColor.replace(/_/g, ' ')} / {liquidVisibility}</span></div>
              )}
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Output</span><span className="text-sm text-white">{flavors.length > 1 ? `Batch (${flavors.length})` : outputMode === 'board' ? 'Full Board (8)' : (selectedScene?.name || <span className="text-gray-600">Not selected</span>)}</span></div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Est. Cost</span><span className="text-sm font-semibold text-green-400">~${((outputMode === 'board' && flavors.length === 1 ? 8 : Math.max(flavors.length, 1)) * 0.055).toFixed(3)}</span></div>
            </div>
          </div>
          <div className="bg-[#11111C] rounded-2xl p-4 border border-teal-500/10 space-y-3">
            <p className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Vector Label Rule</p>
            <p className="text-xs text-gray-500 leading-relaxed">These mockups generate shape, finish, color and scene only — the label area stays blank by design. Your team adds real label artwork as vector graphics afterward.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
