import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'

const pageTitles = {
  '/': 'Dashboard',
  '/generate-image': 'Generate Image',
  '/generate-video': 'Generate Video',
  '/concept-studio': 'Concept Studio',
  '/products': 'Products',
  '/gallery': 'Gallery',
  '/settings': 'Settings',
}

export default function Layout() {
  const location = useLocation()
  const pageTitle = pageTitles[location.pathname] || 'Cherry River'

  return (
    <div className="flex min-h-screen bg-dark">
      <Sidebar />

      {/* Mobile header — only visible below lg */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-[#0D0D14]/80 backdrop-blur-xl border-b border-white/5 px-4 h-14 flex items-center justify-between">
        <img
          src="/logo.jpg"
          alt="Cherry River"
          className="h-8 w-auto object-contain"
          style={{ filter: 'invert(1)', mixBlendMode: 'screen', opacity: 0.95 }}
        />
        <span className="text-sm font-medium text-gray-400">{pageTitle}</span>
      </header>

      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 pb-20 lg:pb-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Outlet />
        </div>
      </main>

      <MobileNav />
    </div>
  )
}
