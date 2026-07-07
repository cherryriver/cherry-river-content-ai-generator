import { useState, useEffect } from 'react'
import { Search, Check, Sparkles, Download, RotateCcw, ChevronDown, Loader2, AlertCircle, ChevronLeft, ChevronRight, Package, PenLine, Wand2, LayoutGrid, X, Paintbrush } from 'lucide-react'
import { apiFetch } from '../lib/apiFetch'

const API_URL = import.meta.env.VITE_API_URL || ''

const formats = [
  { label: '1:1', desc: 'Square', w: 'w-8', h: 'h-8' },
  { label: '4:5', desc: 'Portrait', w: 'w-7', h: 'h-9' },
  { label: '9:16', desc: 'Story', w: 'w-5', h: 'h-9' },
  { label: '16:9', desc: 'Landscape', w: 'w-9', h: 'h-5' },
]

const qualities = ['Draft', 'HD', '4K']
const quantities = [1, 2, 3, 4]

export default function GenerateImage() {
  const [mode, setMode] = useState('single')

  // Single mode state
  const [step, setStep] = useState(1)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [format, setFormat] = useState('1:1')
  const [quality, setQuality] = useState('4K')
  const [quantity, setQuantity] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [enhancedPrompt, setEnhancedPrompt] = useState('')
  const [generated, setGenerated] = useState(false)
  const [generatedImages, setGeneratedImages] = useState([])
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Free Scene mode state
  const [freeScenePrompt, setFreeScenePrompt] = useState('')
  const [freeSceneFormat, setFreeSceneFormat] = useState('1:1')
  const [freeSceneGenerating, setFreeSceneGenerating] = useState(false)
  const [freeSceneProgress, setFreeSceneProgress] = useState(0)
  const [freeSceneError, setFreeSceneError] = useState(null)
  const [freeSceneResult, setFreeSceneResult] = useState(null)
  const [freeSceneEnhancedPrompt, setFreeSceneEnhancedPrompt] = useState('')

  // Collection mode state
  const [selectedProducts, setSelectedProducts] = useState([])
  const [collectionSearch, setCollectionSearch] = useState('')
  const [collectionPrompt, setCollectionPrompt] = useState('')
  const [collectionFormat, setCollectionFormat] = useState('1:1')
  const [collectionGenerating, setCollectionGenerating] = useState(false)
  const [collectionEnhancing, setCollectionEnhancing] = useState(false)
  const [collectionResult, setCollectionResult] = useState(null)
  const [collectionEnhancedPrompt, setCollectionEnhancedPrompt] = useState('')
  const [collectionProgress, setCollectionProgress] = useState(0)
  const [collectionError, setCollectionError] = useState(null)

  const [products, setProducts] = useState([])
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    apiFetch(`${API_URL}/api/products`)
      .then(r => r.json())
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoadingData(false))
  }, [])

  const readyProducts = products.filter(p => p.status === 'ready')
  const filteredProducts = readyProducts.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const groupedProducts = filteredProducts.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  const collectionFiltered = readyProducts.filter(p =>
    p.name.toLowerCase().includes(collectionSearch.toLowerCase()) ||
    p.category.toLowerCase().includes(collectionSearch.toLowerCase())
  )

  const toggleProduct = (product) => {
    setSelectedProducts(prev => {
      const exists = prev.find(p => p.id === product.id)
      if (exists) return prev.filter(p => p.id !== product.id)
      if (prev.length >= 4) return prev
      return [...prev, product]
    })
  }

  const handleGenerate = async () => {
    if (!customPrompt.trim()) { setError('Please write a prompt describing the image you want'); return }
    setEnhancing(true)
    setEnhancedPrompt('')
    setGenerating(false)
    setProgress(0)
    setError(null)
    setGeneratedImages([])
    try {
      await new Promise(r => setTimeout(r, 400))
      setEnhancing(false)
      setGenerating(true)
      const interval = setInterval(() => {
        setProgress(prev => { if (prev >= 90) return 90; return prev + Math.random() * 8 + 2 })
      }, 500)
      const response = await apiFetch(`${API_URL}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selectedProduct.id, productName: selectedProduct.name, productColor: selectedProduct.color, prompt: customPrompt, format, quality, quantity }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) { clearInterval(interval); throw new Error(data.error || 'Generation failed') }
      clearInterval(interval)
      setProgress(100)
      if (data.enhancedPrompt) setEnhancedPrompt(data.enhancedPrompt)
      setGeneratedImages(data.images)
      setActiveImageIndex(0)
      setGenerated(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnhancing(false)
      setGenerating(false)
    }
  }

  const handleGenerateCollection = async () => {
    if (selectedProducts.length < 2) { setCollectionError('Select at least 2 products'); return }
    if (!collectionPrompt.trim()) { setCollectionError('Please describe your scene first'); return }
    setCollectionEnhancing(true)
    setCollectionEnhancedPrompt('')
    setCollectionGenerating(false)
    setCollectionProgress(0)
    setCollectionError(null)
    setCollectionResult(null)
    try {
      await new Promise(r => setTimeout(r, 400))
      setCollectionEnhancing(false)
      setCollectionGenerating(true)
      const interval = setInterval(() => {
        setCollectionProgress(prev => { if (prev >= 88) return 88; return prev + Math.random() * 5 + 1 })
      }, 600)
      const response = await apiFetch(`${API_URL}/api/generate-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: selectedProducts.map(p => p.id), format: collectionFormat, prompt: collectionPrompt }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) { clearInterval(interval); throw new Error(data.error || 'Generation failed') }
      clearInterval(interval)
      setCollectionProgress(100)
      if (data.enhancedPrompt) setCollectionEnhancedPrompt(data.enhancedPrompt)
      setCollectionResult(data.image)
    } catch (err) {
      setCollectionError(err.message)
    } finally {
      setCollectionEnhancing(false)
      setCollectionGenerating(false)
    }
  }

  const handleDownload = async (url, name) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${name || 'collection'}-${Date.now()}.png`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch { window.open(url, '_blank') }
  }

  const handleReset = () => {
    setGenerated(false); setGeneratedImages([]); setActiveImageIndex(0); setProgress(0)
    setError(null); setEnhancedPrompt(''); setStep(1); setSelectedProduct(null); setCustomPrompt('')
  }

  const handleResetCollection = () => {
    setCollectionResult(null); setCollectionEnhancedPrompt(''); setCollectionProgress(0)
    setCollectionError(null); setSelectedProducts([]); setCollectionPrompt('')
  }

  const handleGenerateFreeScene = async () => {
    if (!freeScenePrompt.trim()) { setFreeSceneError('Please describe your scene first'); return }
    setFreeSceneGenerating(true)
    setFreeSceneProgress(0)
    setFreeSceneError(null)
    setFreeSceneResult(null)
    setFreeSceneEnhancedPrompt('')
    try {
      const interval = setInterval(() => {
        setFreeSceneProgress(prev => { if (prev >= 90) return 90; return prev + Math.random() * 6 + 2 })
      }, 500)
      const response = await apiFetch(`${API_URL}/api/generate-free-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: freeScenePrompt, format: freeSceneFormat }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) { clearInterval(interval); throw new Error(data.error || 'Generation failed') }
      clearInterval(interval)
      setFreeSceneProgress(100)
      if (data.enhancedPrompt) setFreeSceneEnhancedPrompt(data.enhancedPrompt)
      setFreeSceneResult(data.image)
    } catch (err) {
      setFreeSceneError(err.message)
    } finally {
      setFreeSceneGenerating(false)
    }
  }

  const handleResetFreeScene = () => {
    setFreeSceneResult(null); setFreeSceneEnhancedPrompt(''); setFreeSceneProgress(0)
    setFreeSceneError(null); setFreeScenePrompt('')
  }

  if (loadingData) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-cherry-light animate-spin" /></div>
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Generate Image</h1>
          <p className="text-gray-400 mt-1">Create professional product images with AI</p>
        </div>
        {/* Mode toggle */}
        <div className="flex gap-1.5 bg-[#11111C] rounded-2xl p-1.5 border border-white/5 flex-shrink-0">
          <button
            onClick={() => setMode('single')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              mode === 'single'
                ? 'bg-gradient-to-r from-cherry/25 to-cherry/10 text-white border border-cherry/30 shadow-[0_0_12px_rgba(196,30,58,0.15)]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Package className="w-3.5 h-3.5" /> Single
          </button>
          <button
            onClick={() => setMode('collection')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              mode === 'collection'
                ? 'bg-gradient-to-r from-violet-500/25 to-violet-500/10 text-white border border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.15)]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Collection Shot
          </button>
          <button
            onClick={() => setMode('freescene')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              mode === 'freescene'
                ? 'bg-gradient-to-r from-amber-500/25 to-amber-500/10 text-white border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Paintbrush className="w-3.5 h-3.5" /> Free Scene
          </button>
        </div>
      </div>

      {readyProducts.length === 0 ? (
        <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-12 border border-border/50 flex flex-col items-center justify-center text-center">
          <Package className="w-12 h-12 text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-400">No products available</h3>
          <p className="text-sm text-gray-600 mt-1 mb-4">Add a product first to start generating images</p>
          <a href="/products" className="bg-cherry hover:bg-cherry-light text-white font-medium px-5 py-2.5 rounded-xl flex items-center gap-2 transition-colors">
            <Package className="w-4 h-4" /> Go to Products
          </a>
        </div>
      ) : mode === 'single' ? (
        <>
          {/* ── SINGLE MODE ── */}
          <div className="flex items-center gap-2">
            {[1, 2].map((s) => (
              <button key={s} onClick={() => s < step || (s === 2 && selectedProduct) ? setStep(s) : null} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                  step === s ? 'bg-cherry text-white shadow-[0_0_20px_rgba(139,0,0,0.4)]' :
                  step > s ? 'bg-cherry/20 text-cherry-light' : 'bg-white/5 text-gray-500'
                }`}>
                  {step > s ? <Check className="w-4 h-4" /> : s}
                </div>
                <span className={`text-sm hidden sm:inline ${step === s ? 'text-white font-medium' : 'text-gray-500'}`}>
                  {s === 1 ? 'Product' : 'Prompt & Options'}
                </span>
                {s < 2 && <div className={`w-12 h-px mx-2 ${step > s ? 'bg-cherry/40' : 'bg-border'}`} />}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {step === 1 && (
                <div className="bg-card/60 rounded-2xl p-6 border border-border/50">
                  <h3 className="text-lg font-semibold text-white mb-4">Select Product</h3>
                  <div className="relative">
                    <button onClick={() => setDropdownOpen(!dropdownOpen)} className="w-full flex items-center justify-between bg-dark rounded-xl px-4 py-3 border border-border hover:border-cherry/40 transition-colors">
                      {selectedProduct ? (
                        <div className="flex items-center gap-3">
                          {selectedProduct.image ? <img src={selectedProduct.image} alt={selectedProduct.name} className="w-8 h-8 rounded-lg object-cover" /> : <div className="w-8 h-8 rounded-lg" style={{ background: selectedProduct.color }} />}
                          <span className="text-white font-medium">{selectedProduct.name}</span>
                          <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">{selectedProduct.category}</span>
                        </div>
                      ) : <span className="text-gray-500">Choose a product...</span>}
                      <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {dropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-card rounded-xl border border-border shadow-2xl z-50 max-h-80 overflow-y-auto">
                        <div className="p-3 border-b border-border sticky top-0 bg-card">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input type="text" placeholder="Search products..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-dark rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 border border-border focus:border-cherry/40 focus:outline-none" />
                          </div>
                        </div>
                        {Object.entries(groupedProducts).map(([category, items]) => (
                          <div key={category}>
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2 bg-dark/50">{category}</p>
                            {items.map(product => (
                              <button key={product.id} onClick={() => { setSelectedProduct(product); setDropdownOpen(false); setStep(2) }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                                {product.image ? <img src={product.image} alt={product.name} className="w-8 h-8 rounded-lg object-cover" /> : <div className="w-8 h-8 rounded-lg" style={{ background: product.color }} />}
                                <span className="text-sm text-white">{product.name}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 2 && generated && generatedImages.length > 0 && (
                <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-6 border border-border/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Generated Images</h3>
                    <button onClick={handleReset} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"><RotateCcw className="w-4 h-4" /> Generate New</button>
                  </div>
                  {enhancedPrompt && (
                    <div className="bg-[#0D0D14] rounded-xl p-4 border border-gold/20">
                      <div className="flex items-center gap-2 mb-2"><Wand2 className="w-3.5 h-3.5 text-gold" /><span className="text-xs font-semibold text-gold uppercase tracking-wider">Claude Enhanced Prompt</span></div>
                      <p className="text-xs text-gray-400 leading-relaxed">{enhancedPrompt}</p>
                    </div>
                  )}
                  <div className={`grid gap-3 ${generatedImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {generatedImages.map((url, i) => (
                      <div key={i} className="relative rounded-xl overflow-hidden group">
                        <img src={url} alt={`Generated ${i + 1}`} className="w-full object-cover rounded-xl" />
                        <button onClick={() => handleDownload(url, selectedProduct?.name)} className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-2 hover:bg-black/80">
                          <Download className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => handleDownload(generatedImages[activeImageIndex], selectedProduct?.name)} className="w-full bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"><Download className="w-4 h-4" /> Download</button>
                </div>
              )}

              {step === 2 && enhancing && (
                <div className="bg-[#11111C] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cherry/20 to-gold/10 flex items-center justify-center"><Wand2 className="w-7 h-7 text-gold animate-pulse" /></div>
                  <div className="text-center"><p className="text-base font-semibold text-white">Claude is enhancing your prompt...</p><p className="text-sm text-gray-500 mt-1">Crafting a VIP photography brief</p></div>
                  <div className="flex gap-1.5">{[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-gold animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
                </div>
              )}

              {step === 2 && generating && (
                <div className="bg-[#11111C] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-full border-4 border-cherry/20 border-t-cherry animate-spin" />
                  <div className="text-center"><p className="text-base font-semibold text-white">Generating your image...</p><p className="text-sm text-gray-500 mt-1">This may take 10–30 seconds</p></div>
                  <div className="w-56 h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cherry to-gold rounded-full transition-all duration-300" style={{ width: `${Math.min(progress, 100)}%` }} /></div>
                  <p className="text-sm text-gray-500">{Math.min(Math.round(progress), 99)}%</p>
                </div>
              )}

              {step === 2 && !generated && !generating && !enhancing && (
                <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-6 border border-border/50 space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3"><PenLine className="w-4 h-4 text-cherry-light" /><p className="text-sm font-medium text-gray-400">Describe your image</p></div>
                    <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="e.g. A premium bottle on a marble countertop in a luxury bar, warm golden lighting, bokeh background, cinematic photography..." rows={4} className="w-full bg-dark rounded-xl px-4 py-3 text-white placeholder-gray-600 border border-border focus:border-cherry/40 focus:outline-none resize-none text-sm leading-relaxed" />
                    <p className="text-xs text-gray-600 mt-2">Be descriptive — mention setting, lighting, mood, camera angle, style</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-3">Format</p>
                    <div className="grid grid-cols-4 gap-2">
                      {formats.map(f => (
                        <button key={f.label} onClick={() => setFormat(f.label)} className={`flex flex-col items-center gap-2 px-1 sm:px-4 py-3 rounded-xl border transition-all ${format === f.label ? 'border-cherry bg-cherry/10 shadow-[0_0_15px_rgba(139,0,0,0.2)]' : 'border-border bg-dark hover:border-border'}`}>
                          <div className={`${f.w} ${f.h} rounded border-2 ${format === f.label ? 'border-cherry-light' : 'border-gray-600'}`} />
                          <span className={`text-xs font-medium ${format === f.label ? 'text-white' : 'text-gray-500'}`}>{f.label}</span>
                          <span className="text-[10px] text-gray-600">{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-3">Quality</p>
                    <div className="flex gap-3">
                      {qualities.map(q => <button key={q} onClick={() => setQuality(q)} className={`px-5 py-2.5 rounded-xl text-sm font-medium border transition-all ${quality === q ? 'border-cherry bg-cherry/10 text-white' : 'border-border bg-dark text-gray-500 hover:text-gray-300'}`}>{q}</button>)}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-3">Quantity</p>
                    <div className="flex gap-3">
                      {quantities.map(q => <button key={q} onClick={() => setQuantity(q)} className={`w-12 h-12 rounded-xl text-sm font-semibold border transition-all ${quantity === q ? 'border-cherry bg-cherry/10 text-white' : 'border-border bg-dark text-gray-500 hover:text-gray-300'}`}>{q}</button>)}
                    </div>
                  </div>
                  {error && (
                    <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                      <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                      <div><p className="text-sm font-medium text-red-400">Generation failed</p><p className="text-xs text-red-400/70 mt-0.5">{error}</p></div>
                    </div>
                  )}
                  <button onClick={handleGenerate} disabled={generating || !customPrompt.trim()} className="w-full bg-gradient-to-r from-cherry to-cherry-dark hover:from-cherry-light hover:to-cherry text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_30px_rgba(139,0,0,0.3)] disabled:opacity-50">
                    {generating ? <><Loader2 className="w-5 h-5 animate-spin" /> Generating...</> : <><Sparkles className="w-5 h-5" /> Generate Image</>}
                  </button>
                </div>
              )}
            </div>

            {/* Right: Summary */}
            <div className="space-y-4">
              <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-5 border border-border/50 space-y-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Summary</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Product</span>{selectedProduct ? <span className="text-sm text-white truncate ml-4 max-w-[140px]">{selectedProduct.name}</span> : <span className="text-sm text-gray-600">Not selected</span>}</div>
                  <div className="h-px bg-border" />
                  <div><span className="text-sm text-gray-500">Prompt</span><p className="text-sm text-white mt-1 line-clamp-3">{customPrompt || <span className="text-gray-600">Not written yet</span>}</p></div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Format</span><span className="text-sm text-white">{format}</span></div>
                  <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Quality</span><span className="text-sm text-white">{quality}</span></div>
                  <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Quantity</span><span className="text-sm text-white">{quantity}</span></div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Est. Cost</span><span className="text-sm font-semibold text-green-400">~${(quantity * 0.055).toFixed(3)}</span></div>
                </div>
              </div>
              <div className="bg-card/60 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden">
                <div className="p-4 border-b border-border/50"><h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Preview</h3></div>
                <div className="aspect-square relative">
                  {generating ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-dark">
                      <div className="w-16 h-16 rounded-full border-4 border-cherry/20 border-t-cherry animate-spin" />
                      <div className="text-center"><p className="text-sm font-medium text-white">Generating...</p><p className="text-xs text-gray-500 mt-1">{Math.min(Math.round(progress), 99)}%</p></div>
                      <div className="w-48 h-1.5 bg-dark rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cherry to-gold rounded-full transition-all duration-300" style={{ width: `${Math.min(progress, 100)}%` }} /></div>
                    </div>
                  ) : generated && generatedImages.length > 0 ? (
                    <div className="absolute inset-0">
                      <img src={generatedImages[activeImageIndex]} alt={selectedProduct?.name} className="w-full h-full object-cover" />
                      {generatedImages.length > 1 && (
                        <>
                          <button onClick={() => setActiveImageIndex(i => (i - 1 + generatedImages.length) % generatedImages.length)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 backdrop-blur-sm rounded-full p-1.5 hover:bg-black/70 transition-colors"><ChevronLeft className="w-4 h-4 text-white" /></button>
                          <button onClick={() => setActiveImageIndex(i => (i + 1) % generatedImages.length)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 backdrop-blur-sm rounded-full p-1.5 hover:bg-black/70 transition-colors"><ChevronRight className="w-4 h-4 text-white" /></button>
                          <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1"><span className="text-xs text-white font-medium">{activeImageIndex + 1}/{generatedImages.length}</span></div>
                        </>
                      )}
                      <div className="absolute bottom-4 left-4 right-4 flex gap-2">
                        <button onClick={() => handleDownload(generatedImages[activeImageIndex], selectedProduct?.name)} className="flex-1 bg-white/10 backdrop-blur-sm rounded-lg py-2.5 text-sm font-medium text-white hover:bg-white/20 transition-colors flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Download</button>
                        <button onClick={handleReset} className="bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2.5 text-white hover:bg-white/20 transition-colors"><RotateCcw className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600"><Sparkles className="w-8 h-8 mb-2" /><p className="text-sm">Your image will appear here</p></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : mode === 'freescene' ? (
        <>
          {/* ── FREE SCENE MODE ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              {!freeSceneResult && !freeSceneGenerating && (
                <div className="bg-card/60 rounded-2xl p-6 border border-border/50 space-y-5">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Free Scene</h3>
                    <p className="text-sm text-gray-500 mt-0.5">No product required — describe any scene: cocktail setups, lifestyle shots, mood boards</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2"><PenLine className="w-4 h-4 text-amber-400" /><p className="text-sm font-medium text-gray-400">Describe your scene</p></div>
                    <textarea
                      value={freeScenePrompt}
                      onChange={(e) => setFreeScenePrompt(e.target.value)}
                      placeholder="e.g. A vibrant summer cocktail setup on a marble poolside table — raspberry gin sour in a coupe glass, fresh raspberries scattered, golden hour backlight, condensation on the glass..."
                      rows={5}
                      className="w-full bg-dark rounded-xl px-4 py-3 text-white placeholder-gray-600 border border-border focus:border-amber-500/40 focus:outline-none resize-none text-sm leading-relaxed"
                    />
                    <p className="text-xs text-gray-600 mt-2">Describe setting, props, lighting, mood — no product image needed</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-3">Format</p>
                    <div className="grid grid-cols-4 gap-2">
                      {formats.map(f => (
                        <button key={f.label} onClick={() => setFreeSceneFormat(f.label)} className={`flex flex-col items-center gap-2 px-1 sm:px-4 py-3 rounded-xl border transition-all ${freeSceneFormat === f.label ? 'border-amber-500/50 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.15)]' : 'border-border bg-dark hover:border-border'}`}>
                          <div className={`${f.w} ${f.h} rounded border-2 ${freeSceneFormat === f.label ? 'border-amber-400' : 'border-gray-600'}`} />
                          <span className={`text-xs font-medium ${freeSceneFormat === f.label ? 'text-white' : 'text-gray-500'}`}>{f.label}</span>
                          <span className="text-[10px] text-gray-600">{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {freeSceneError && (
                    <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                      <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                      <div><p className="text-sm font-medium text-red-400">Generation failed</p><p className="text-xs text-red-400/70 mt-0.5">{freeSceneError}</p></div>
                    </div>
                  )}

                  <button
                    onClick={handleGenerateFreeScene}
                    disabled={freeSceneGenerating || !freeScenePrompt.trim()}
                    className="w-full bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_30px_rgba(245,158,11,0.2)] disabled:opacity-50"
                  >
                    {freeSceneGenerating ? <><Loader2 className="w-5 h-5 animate-spin" /> Generating...</> : <><Sparkles className="w-5 h-5" /> Generate Free Scene</>}
                  </button>
                </div>
              )}

              {freeSceneGenerating && (
                <div className="bg-[#11111C] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
                  <div className="text-center"><p className="text-base font-semibold text-white">Generating your scene...</p><p className="text-sm text-gray-500 mt-1">This may take 10–30 seconds</p></div>
                  <div className="w-56 h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all duration-300" style={{ width: `${Math.min(freeSceneProgress, 100)}%` }} /></div>
                  <p className="text-sm text-gray-500">{Math.min(Math.round(freeSceneProgress), 99)}%</p>
                </div>
              )}

              {freeSceneResult && (
                <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-6 border border-border/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Free Scene</h3>
                    <button onClick={handleResetFreeScene} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"><RotateCcw className="w-4 h-4" /> Generate New</button>
                  </div>
                  {freeSceneEnhancedPrompt && (
                    <div className="bg-[#0D0D14] rounded-xl p-4 border border-amber-500/20">
                      <div className="flex items-center gap-2 mb-2"><Wand2 className="w-3.5 h-3.5 text-amber-400" /><span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Claude Enhanced Prompt</span></div>
                      <p className="text-xs text-gray-400 leading-relaxed">{freeSceneEnhancedPrompt}</p>
                    </div>
                  )}
                  <div className="relative rounded-xl overflow-hidden group">
                    <img src={freeSceneResult} alt="Free scene" className="w-full object-cover rounded-xl" />
                    <button onClick={() => handleDownload(freeSceneResult, 'free-scene')} className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-2 hover:bg-black/80"><Download className="w-4 h-4 text-white" /></button>
                  </div>
                  <button onClick={() => handleDownload(freeSceneResult, 'free-scene')} className="w-full bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_16px_rgba(245,158,11,0.2)]"><Download className="w-4 h-4" /> Download PNG</button>
                </div>
              )}
            </div>

            {/* Right: Summary */}
            <div className="space-y-4">
              <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-5 border border-border/50 space-y-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Summary</h3>
                <div className="space-y-3">
                  <div><span className="text-sm text-gray-500">Prompt</span><p className="text-sm text-white mt-1 line-clamp-4">{freeScenePrompt || <span className="text-gray-600">Not written yet</span>}</p></div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Format</span><span className="text-sm text-white">{freeSceneFormat}</span></div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Est. Cost</span><span className="text-sm font-semibold text-green-400">~$0.055</span></div>
                </div>
              </div>
              <div className="bg-[#11111C] rounded-2xl p-4 border border-amber-500/10 space-y-3">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Free Scene</p>
                <p className="text-xs text-gray-500 leading-relaxed">No product required. Claude enhances your prompt into a professional photography brief before sending to Flux 2 Pro.</p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ── COLLECTION SHOT MODE ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              {/* Product multi-select grid */}
              {!collectionResult && !collectionGenerating && !collectionEnhancing && (
                <div className="bg-card/60 rounded-2xl p-6 border border-border/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Select Products</h3>
                      <p className="text-sm text-gray-500 mt-0.5">Pick 2–4 products for your collection shot</p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${selectedProducts.length >= 2 ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'bg-white/5 text-gray-500 border-white/10'}`}>
                      {selectedProducts.length}/4
                    </div>
                  </div>

                  {/* Selected products preview strip */}
                  {selectedProducts.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {selectedProducts.map(p => (
                        <div key={p.id} className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2">
                          {p.image && <img src={p.image} alt={p.name} className="w-6 h-6 rounded object-cover" />}
                          <span className="text-xs text-violet-300 font-medium max-w-[120px] truncate">{p.name}</span>
                          <button onClick={() => toggleProduct(p)} className="text-violet-400 hover:text-violet-200 transition-colors"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input type="text" placeholder="Search products..." value={collectionSearch} onChange={(e) => setCollectionSearch(e.target.value)} className="w-full bg-dark rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 border border-border focus:border-violet-500/40 focus:outline-none" />
                  </div>

                  {/* Product grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
                    {collectionFiltered.map(product => {
                      const isSelected = selectedProducts.find(p => p.id === product.id)
                      const isDisabled = !isSelected && selectedProducts.length >= 4
                      return (
                        <button
                          key={product.id}
                          onClick={() => !isDisabled && toggleProduct(product)}
                          disabled={isDisabled}
                          className={`relative rounded-xl border p-2 flex flex-col items-center gap-1.5 transition-all ${
                            isSelected ? 'border-violet-500/50 bg-violet-500/10' :
                            isDisabled ? 'border-white/5 bg-dark/50 opacity-40 cursor-not-allowed' :
                            'border-white/5 bg-dark hover:border-white/15'
                          }`}
                        >
                          {product.image ? (
                            <img src={product.image} alt={product.name} className="w-full aspect-square rounded-lg object-contain p-1" />
                          ) : (
                            <div className="w-full aspect-square rounded-lg" style={{ background: product.color }} />
                          )}
                          <span className="text-[10px] text-gray-400 text-center leading-tight line-clamp-2 w-full">{product.name}</span>
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center shadow-[0_0_8px_rgba(139,92,246,0.5)]">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Optional notes */}
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-2">Describe your scene <span className="text-red-400 text-xs">*</span></p>
                    <textarea
                      value={collectionPrompt}
                      onChange={(e) => setCollectionPrompt(e.target.value)}
                      placeholder="e.g. Summer rooftop party vibe, pastel tones, lime and mint props, warm golden hour light..."
                      rows={3}
                      className="w-full bg-dark rounded-xl px-4 py-3 text-white placeholder-gray-600 border border-border focus:border-violet-500/40 focus:outline-none resize-none text-sm leading-relaxed"
                    />
                  </div>

                  {/* Format */}
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-3">Format</p>
                    <div className="grid grid-cols-4 gap-2">
                      {formats.map(f => (
                        <button key={f.label} onClick={() => setCollectionFormat(f.label)} className={`flex flex-col items-center gap-2 px-1 sm:px-4 py-3 rounded-xl border transition-all ${collectionFormat === f.label ? 'border-violet-500/50 bg-violet-500/10 shadow-[0_0_15px_rgba(139,92,246,0.15)]' : 'border-border bg-dark'}`}>
                          <div className={`${f.w} ${f.h} rounded border-2 ${collectionFormat === f.label ? 'border-violet-400' : 'border-gray-600'}`} />
                          <span className={`text-xs font-medium ${collectionFormat === f.label ? 'text-white' : 'text-gray-500'}`}>{f.label}</span>
                          <span className="text-[10px] text-gray-600">{f.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {collectionError && (
                    <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                      <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                      <div><p className="text-sm font-medium text-red-400">Generation failed</p><p className="text-xs text-red-400/70 mt-0.5">{collectionError}</p></div>
                    </div>
                  )}

                  <button
                    onClick={handleGenerateCollection}
                    disabled={selectedProducts.length < 2 || !collectionPrompt.trim()}
                    className="w-full bg-gradient-to-r from-violet-600 to-violet-800 hover:from-violet-500 hover:to-violet-700 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_30px_rgba(139,92,246,0.25)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <LayoutGrid className="w-5 h-5" />
                    {selectedProducts.length < 2 ? `Select ${2 - selectedProducts.length} more product${2 - selectedProducts.length !== 1 ? 's' : ''}` : !collectionPrompt.trim() ? 'Describe your scene to continue' : `Generate Collection Shot (${selectedProducts.length} products)`}
                  </button>
                </div>
              )}

              {/* Enhancing state */}
              {collectionEnhancing && (
                <div className="bg-[#11111C] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center"><Wand2 className="w-7 h-7 text-violet-400 animate-pulse" /></div>
                  <div className="text-center"><p className="text-base font-semibold text-white">Claude is composing your scene...</p><p className="text-sm text-gray-500 mt-1">Analyzing all {selectedProducts.length} products</p></div>
                  <div className="flex gap-1.5">{[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
                </div>
              )}

              {/* Generating state */}
              {collectionGenerating && (
                <div className="bg-[#11111C] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center gap-4">
                  <div className="w-16 h-16 rounded-full border-4 border-violet-500/20 border-t-violet-500 animate-spin" />
                  <div className="text-center"><p className="text-base font-semibold text-white">Generating collection shot...</p><p className="text-sm text-gray-500 mt-1">This may take 20–40 seconds</p></div>
                  <div className="w-56 h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all duration-300" style={{ width: `${Math.min(collectionProgress, 100)}%` }} /></div>
                  <p className="text-sm text-gray-500">{Math.min(Math.round(collectionProgress), 99)}%</p>
                </div>
              )}

              {/* Collection result */}
              {collectionResult && (
                <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-6 border border-border/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Collection Shot</h3>
                    <button onClick={handleResetCollection} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"><RotateCcw className="w-4 h-4" /> Generate New</button>
                  </div>
                  {collectionEnhancedPrompt && (
                    <div className="bg-[#0D0D14] rounded-xl p-4 border border-violet-500/20">
                      <div className="flex items-center gap-2 mb-2"><Wand2 className="w-3.5 h-3.5 text-violet-400" /><span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Claude Scene Brief</span></div>
                      <p className="text-xs text-gray-400 leading-relaxed">{collectionEnhancedPrompt}</p>
                    </div>
                  )}
                  <div className="relative rounded-xl overflow-hidden group">
                    <img src={collectionResult} alt="Collection shot" className="w-full object-cover rounded-xl" />
                    <button onClick={() => handleDownload(collectionResult, 'collection')} className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm rounded-full p-2 hover:bg-black/80"><Download className="w-4 h-4 text-white" /></button>
                  </div>
                  <button onClick={() => handleDownload(collectionResult, 'collection')} className="w-full bg-gradient-to-r from-violet-600 to-violet-800 hover:from-violet-500 hover:to-violet-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_16px_rgba(139,92,246,0.25)]"><Download className="w-4 h-4" /> Download PNG</button>
                </div>
              )}
            </div>

            {/* Right: Collection summary */}
            <div className="space-y-4">
              <div className="bg-card/60 backdrop-blur-sm rounded-2xl p-5 border border-border/50 space-y-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Collection</h3>
                {selectedProducts.length === 0 ? (
                  <p className="text-sm text-gray-600">No products selected yet</p>
                ) : (
                  <div className="space-y-2">
                    {selectedProducts.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-4 flex-shrink-0">{i + 1}.</span>
                        {p.image ? <img src={p.image} alt={p.name} className="w-8 h-8 rounded-lg object-contain bg-dark p-0.5 flex-shrink-0" /> : <div className="w-8 h-8 rounded-lg flex-shrink-0" style={{ background: p.color }} />}
                        <span className="text-xs text-white truncate">{p.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="h-px bg-border" />
                <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Format</span><span className="text-sm text-white">{collectionFormat}</span></div>
                <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Est. Cost</span><span className="text-sm font-semibold text-green-400">~$0.055</span></div>
              </div>

              <div className="bg-[#11111C] rounded-2xl p-4 border border-violet-500/10 space-y-3">
                <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">De Soi Style</p>
                <p className="text-xs text-gray-500 leading-relaxed">Products at different heights on natural risers — wine glass, stone slab, wood board. Seasonal props, warm lifestyle lighting.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
