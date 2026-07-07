import { useState, useEffect, useRef } from 'react'
import { Plus, Search, Package, Loader2, Trash2, X, Upload, ImageIcon, Wine, Container } from 'lucide-react'
import { apiFetch } from '../lib/apiFetch'

const API_URL = import.meta.env.VITE_API_URL || ''

// Resize + compress image client-side before upload.
// Vercel serverless functions have a 4.5MB body limit — phone photos are 5-15MB.
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

const categories = ['Gins', 'Vodkas', 'Rums', 'Liqueurs', 'Mocktails', 'Spirits']

const statusConfig = {
  ready: { label: 'Ready', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  training: { label: 'Training', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  pending: { label: 'Pending', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
}

export default function Products() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('All')
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [formData, setFormData] = useState({ name: '', category: 'Gins', color: '#C41E3A', productType: 'bottle' })
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState(null)
  const [uploadingFor, setUploadingFor] = useState(null) // product id being uploaded to
  const fileInputRef = useRef(null)
  const cardFileInputRef = useRef(null)

  const fetchProducts = () => {
    apiFetch(`${API_URL}/api/products`)
      .then(r => r.json())
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchProducts() }, [])

  const allCategories = ['All', ...new Set(products.map(p => p.category))]

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchCategory = filterCategory === 'All' || p.category === filterCategory
    return matchSearch && matchCategory
  })

  const handleImageSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setImagePreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleAddProduct = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) return
    setSubmitting(true)
    setAddError(null)
    try {
      const fd = new FormData()
      fd.append('name', formData.name)
      fd.append('category', formData.category)
      fd.append('color', formData.color)
      fd.append('productType', formData.productType)
      fd.append('status', 'ready')
      if (imageFile) fd.append('image', await compressImage(imageFile))

      const res = await apiFetch(`${API_URL}/api/products`, {
        method: 'POST',
        body: fd,
      })
      if (res.ok) {
        setShowModal(false)
        setFormData({ name: '', category: 'Gins', color: '#C41E3A', productType: 'bottle' })
        setImageFile(null)
        setImagePreview(null)
        fetchProducts() // re-fetch from server to guarantee sync
      } else {
        const data = await res.json().catch(() => ({}))
        setAddError(data.error || `Server error (${res.status}) — please try again`)
      }
    } catch (err) {
      console.error(err)
      setAddError('Network error — check your connection and try again')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUploadForProduct = async (productId, file) => {
    if (!file) return
    setUploadingFor(productId)
    try {
      const fd = new FormData()
      fd.append('image', await compressImage(file))
      const res = await apiFetch(`${API_URL}/api/products/${productId}/image`, {
        method: 'POST',
        body: fd,
      })
      if (res.ok) {
        const updated = await res.json()
        setProducts(prev => prev.map(p => p.id === productId ? updated : p))
      }
    } catch (err) {
      console.error(err)
    } finally {
      setUploadingFor(null)
    }
  }

  const handleDelete = async (id) => {
    try {
      const res = await apiFetch(`${API_URL}/api/products/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setProducts(prev => prev.filter(p => p.id !== id))
      }
    } catch (err) {
      console.error(err)
    }
    setDeleteConfirm(null)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Products</h1>
          <p className="text-gray-500 mt-1 text-sm">{products.length} products in your library</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-gradient-to-r from-cherry to-cherry-dark hover:from-cherry-light hover:to-cherry text-white font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(196,30,58,0.3)] hover:shadow-[0_0_30px_rgba(196,30,58,0.4)]"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      {/* Filters */}
      {products.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#11111C] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 border border-white/5 focus:border-cherry/30 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {allCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                  filterCategory === cat
                    ? 'bg-cherry/15 text-white border border-cherry/30 shadow-[0_0_12px_rgba(196,30,58,0.15)]'
                    : 'bg-[#11111C] text-gray-500 border border-white/5 hover:text-gray-200 hover:border-white/10'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Products Grid or Empty State */}
      {products.length === 0 ? (
        <div className="bg-[#11111C] backdrop-blur-sm rounded-2xl p-14 border border-white/5 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-3xl mb-6 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(196,30,58,0.15), rgba(212,175,55,0.1))' }}>
            <Package className="w-10 h-10 text-gray-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-300">No products yet</h3>
          <p className="text-sm text-gray-600 mt-2 mb-6 max-w-xs">Add your first product to start generating premium content</p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-gradient-to-r from-cherry to-cherry-dark hover:from-cherry-light hover:to-cherry text-white font-semibold px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(196,30,58,0.3)]"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 overflow-hidden">
          {filtered.map(product => {
            const status = statusConfig[product.status] || statusConfig.ready
            const isUploading = uploadingFor === product.id
            return (
              <div
                key={product.id}
                className="group bg-[#11111C] backdrop-blur-sm rounded-2xl overflow-hidden border border-white/5 hover:border-white/10 hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300 relative"
              >
                {/* Image section — fills full card top */}
                <div
                  className="aspect-square relative"
                  style={{ background: `linear-gradient(135deg, ${product.color}33, ${product.color}11)` }}
                >
                  {product.image ? (
                    <img
                      src={product.image.startsWith('http') ? product.image : `${API_URL}${product.image}`}
                      alt={product.name}
                      className="w-full h-full object-contain p-3"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="w-14 h-20 rounded-lg shadow-xl group-hover:scale-105 transition-transform duration-300"
                        style={{ background: `linear-gradient(180deg, ${product.color}, ${product.color}CC)` }}
                      />
                    </div>
                  )}

                  {/* Gradient overlay with product name at bottom */}
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="font-semibold text-white text-sm leading-tight drop-shadow truncate">{product.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-white/50 truncate">{product.category}</p>
                      {product.productType === 'can' && (
                        <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded-full leading-none">Can</span>
                      )}
                    </div>
                  </div>

                  {/* Status badge top left */}
                  <div className="absolute top-2.5 left-2.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${status.color}`}>
                      {status.label}
                    </span>
                  </div>

                  {/* Upload overlay */}
                  {isUploading ? (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-cherry-light animate-spin" />
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        cardFileInputRef.current.dataset.productId = product.id
                        cardFileInputRef.current.click()
                      }}
                      className="absolute top-2.5 right-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm rounded-full p-2 hover:bg-cherry/60"
                      title="Upload image"
                    >
                      <Upload className="w-3.5 h-3.5 text-white" />
                    </button>
                  )}

                  <button
                    onClick={() => setDeleteConfirm(product.id)}
                    className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm rounded-full p-2 hover:bg-red-500/50"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Hidden file input for card uploads */}
          <input
            ref={cardFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files[0]
              const productId = e.target.dataset.productId
              if (file && productId) handleUploadForProduct(productId, file)
              e.target.value = ''
            }}
          />

          {/* Add Product Card */}
          <button
            onClick={() => setShowModal(true)}
            className="bg-[#0D0D14] rounded-2xl border-2 border-dashed border-white/8 hover:border-cherry/30 hover:bg-[#11111C] transition-all flex flex-col items-center justify-center gap-3 min-h-[240px] group"
          >
            <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center group-hover:bg-cherry/10 transition-colors">
              <Plus className="w-7 h-7 text-gray-600 group-hover:text-cherry-light transition-colors" />
            </div>
            <span className="text-sm text-gray-600 group-hover:text-gray-300 transition-colors font-medium">Add Product</span>
          </button>
        </div>
      )}

      {/* Add Product Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => { setShowModal(false); setImageFile(null); setImagePreview(null); setAddError(null) }}>
          <div
            className="bg-[#11111C] backdrop-blur-xl rounded-2xl border border-white/8 max-w-md w-full p-6 shadow-[0_32px_80px_rgba(0,0,0,0.8)] max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Add Product</h2>
              <button onClick={() => { setShowModal(false); setImageFile(null); setImagePreview(null); setAddError(null) }} className="bg-white/5 hover:bg-white/10 rounded-xl p-2 transition-colors">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleAddProduct} className="space-y-5">
              {/* Product Image Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Product Image</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageSelect}
                />
                {imagePreview ? (
                  <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-white/8">
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center group/img cursor-pointer"
                      onClick={() => fileInputRef.current.click()}
                    >
                      <div className="opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col items-center gap-1">
                        <Upload className="w-6 h-6 text-white" />
                        <span className="text-xs text-white font-medium">Change image</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setImageFile(null); setImagePreview(null) }}
                      className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5 hover:bg-red-500/60 transition-colors"
                    >
                      <X className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current.click()}
                    className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-white/8 hover:border-cherry/30 transition-colors flex flex-col items-center justify-center gap-2 bg-[#0D0D14]"
                  >
                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-gray-600" />
                    </div>
                    <span className="text-sm text-gray-500">Click to upload product image</span>
                    <span className="text-xs text-gray-700">PNG, JPG, WebP up to 10MB</span>
                  </button>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Product Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Gin Rouge"
                  required
                  className="w-full bg-[#0D0D14] rounded-xl px-4 py-3 text-white placeholder-gray-700 border border-white/8 focus:border-cherry/30 focus:outline-none text-sm"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full bg-[#0D0D14] rounded-xl px-4 py-3 text-white border border-white/8 focus:border-cherry/30 focus:outline-none cursor-pointer text-sm"
                  style={{ colorScheme: 'dark' }}
                >
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Product Type — icon-style cards */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Product Type</label>
                <div className="flex gap-3">
                  {[
                    { value: 'bottle', label: 'Bottle', icon: Wine, desc: 'Glass bottle' },
                    { value: 'can', label: 'Can', icon: Container, desc: 'Aluminum can' },
                  ].map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, productType: t.value }))}
                      className={`flex-1 flex flex-col items-center gap-2 py-4 rounded-xl text-sm font-medium border transition-all ${
                        formData.productType === t.value
                          ? 'border-cherry/40 bg-cherry/10 text-white shadow-[0_0_16px_rgba(196,30,58,0.15)]'
                          : 'border-white/8 bg-[#0D0D14] text-gray-500 hover:text-gray-300 hover:border-white/15'
                      }`}
                    >
                      <t.icon className={`w-6 h-6 ${formData.productType === t.value ? 'text-cherry-light' : 'text-gray-600'}`} />
                      <span>{t.label}</span>
                      <span className={`text-xs font-normal ${formData.productType === t.value ? 'text-gray-400' : 'text-gray-700'}`}>{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Brand Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                    className="w-12 h-12 rounded-xl border border-white/8 cursor-pointer bg-transparent"
                  />
                  <span className="text-sm text-gray-500 font-mono">{formData.color}</span>
                </div>
              </div>

              {/* Preview */}
              <div className="bg-[#0D0D14] rounded-xl p-4 flex items-center gap-4 border border-white/5">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="w-10 h-14 rounded-lg shadow-lg object-cover" />
                ) : (
                  <div className="w-10 h-14 rounded-lg shadow-lg flex-shrink-0" style={{ background: `linear-gradient(180deg, ${formData.color}, ${formData.color}CC)` }} />
                )}
                <div>
                  <p className="text-sm font-semibold text-white">{formData.name || 'Product Name'}</p>
                  <p className="text-xs text-gray-500">{formData.category} · {formData.productType}</p>
                </div>
              </div>

              {/* Error */}
              {addError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
                  <span className="text-red-400 text-sm leading-snug">{addError}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !formData.name.trim()}
                className="w-full bg-gradient-to-r from-cherry to-cherry-dark hover:from-cherry-light hover:to-cherry text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(196,30,58,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Add Product
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div
            className="bg-[#11111C] backdrop-blur-xl rounded-2xl border border-white/8 max-w-sm w-full p-6 shadow-[0_24px_60px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-1">Delete Product</h2>
            <p className="text-sm text-gray-500 mb-6">Are you sure you want to delete this product? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-2.5 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-500/15 hover:bg-red-500/25 text-red-400 font-semibold py-2.5 rounded-xl transition-colors border border-red-500/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
