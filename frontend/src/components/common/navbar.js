// file: ./frontend/src/components/common/navbar.js
import React, { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
import { HiMagnifyingGlassPlus } from 'react-icons/hi2';
import { LuImageUp } from 'react-icons/lu';
import {
  GiBarbecue,
  GiCrossedSwords,
  GiDeathSkull,
  GiSpikedDragonHead,
  GiSpellBook,
} from 'react-icons/gi';
import { FiBookOpen, FiCompass, FiLogOut, FiMenu, FiSettings, FiShield, FiShoppingBag, FiX } from 'react-icons/fi';
import { GoSidebarCollapse, GoSidebarExpand } from 'react-icons/go';
import { storage, db } from '../firebaseConfig';
import { ref as storageRef, deleteObject, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { useShellLayout } from './shellLayout';

const NAV_ITEMS = [
  {
    label: 'Home',
    path: '/home',
    icon: GiSpikedDragonHead,
    iconOnly: true,
    end: true,
  },
  {
    label: 'Bazaar',
    path: '/bazaar',
    icon: FiShoppingBag,
    end: true,
  },
  {
    label: 'Combat',
    path: '/combat',
    icon: GiCrossedSwords,
    end: true,
  },
  {
    label: 'Tecniche | Spell',
    path: '/tecniche-spell',
    icon: GiSpellBook,
    end: true,
  },
  {
    label: 'Codex',
    path: '/codex',
    icon: FiBookOpen,
    end: true,
  },
  {
    label: 'Echi di Viaggio',
    path: '/echi-di-viaggio',
    icon: FiCompass,
    end: true,
  },
  {
    label: 'Grigliata',
    path: '/grigliata',
    icon: GiBarbecue,
    end: true,
  },
  {
    label: 'DM Dashboard',
    path: '/dm-dashboard',
    icon: FiShield,
    roles: ['dm'],
    end: true,
  },
  {
    label: 'Foes Hub',
    path: '/foes-hub',
    icon: GiDeathSkull,
    roles: ['dm'],
    end: true,
  },
  {
    label: 'Admin',
    path: '/admin',
    icon: FiSettings,
    roles: ['webmaster'],
    end: true,
  },
];

const BASE_NAV_ITEM_CLASS = 'group flex w-full items-center overflow-hidden rounded-2xl border text-sm transition-all duration-[280ms] ease-out motion-reduce:transition-none';
const ACTIVE_NAV_ITEM_CLASS = 'border-amber-300/80 bg-amber-400/25 text-white shadow-lg shadow-amber-500/10';
const INACTIVE_NAV_ITEM_CLASS = 'border-transparent bg-transparent text-slate-200 hover:border-amber-200/30 hover:bg-white/5 hover:text-white';
const ACTION_BUTTON_CLASS = 'inline-flex items-center justify-center rounded-full border border-slate-500/40 bg-slate-900/70 text-slate-100 transition-colors duration-200 hover:border-amber-300/60 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-45';
const COLLAPSIBLE_TEXT_CLASS = 'min-w-0 truncate transition-[max-width,opacity,transform] duration-[240ms] ease-out motion-reduce:transition-none';
const noop = () => {};

const buildProfileImageLabel = (user, userData) => (
  userData?.characterId || user?.email || 'User'
);

const Avatar = ({ user, userData, className = '', imageClassName = '' }) => {
  const fallbackLabel = buildProfileImageLabel(user, userData);

  return (
    <>
      {userData?.stats?.level ? (
        <div className="absolute -bottom-1 -left-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-950 bg-sky-500 text-xs font-semibold text-white shadow-lg">
          {userData.stats.level}
        </div>
      ) : null}
      {userData?.imageUrl ? (
        <img
          src={userData.imageUrl}
          alt="Character Avatar"
          className={`rounded-full border-2 border-white/90 object-cover shadow-lg ${className} ${imageClassName}`.trim()}
        />
      ) : (
        <div
          className={`flex items-center justify-center rounded-full border-2 border-dashed border-slate-400/55 bg-slate-700 text-[11px] font-semibold text-slate-100 ${className}`.trim()}
        >
          {fallbackLabel.slice(0, 2).toUpperCase()}
        </div>
      )}
    </>
  );
};

const ProfileActions = ({
  canPreview,
  compact,
  onOpenPreview,
  onOpenUpload,
  className = '',
  buttonClassName = '',
  iconClassName = '',
}) => (
  <div className={`flex ${compact ? 'flex-col items-center' : 'items-center'} gap-2 ${className}`.trim()}>
    <button
      type="button"
      onClick={onOpenPreview}
      disabled={!canPreview}
      className={`${ACTION_BUTTON_CLASS} ${compact ? 'h-10 w-10' : 'h-9 w-9'} ${buttonClassName}`.trim()}
      aria-label="Preview profile image"
      title={canPreview ? 'Preview profile image' : 'No image to preview'}
    >
      <HiMagnifyingGlassPlus className={`${compact ? 'text-lg' : 'text-base'} ${iconClassName}`.trim()} />
    </button>
    <button
      type="button"
      onClick={onOpenUpload}
      className={`${ACTION_BUTTON_CLASS} ${compact ? 'h-10 w-10' : 'h-9 w-9'} ${buttonClassName}`.trim()}
      aria-label="Upload profile image"
      title="Upload profile image"
    >
      <LuImageUp className={`${compact ? 'text-lg' : 'text-base'} ${iconClassName}`.trim()} />
    </button>
  </div>
);

const NavList = ({ collapsed, navItems, onNavigate }) => (
  <nav className="flex-1 overflow-y-auto pr-1" aria-label="Primary">
    <ul className="space-y-2">
      {navItems.map((item) => {
        const Icon = item.icon;

        return (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) => [
                BASE_NAV_ITEM_CLASS,
                isActive ? ACTIVE_NAV_ITEM_CLASS : INACTIVE_NAV_ITEM_CLASS,
                collapsed ? 'justify-center px-3 py-3' : 'gap-3 px-4 py-3',
              ].join(' ')}
              aria-label={collapsed || item.iconOnly ? item.label : undefined}
              title={collapsed || item.iconOnly ? item.label : undefined}
            >
              {Icon ? <Icon className="shrink-0 text-[1.2rem] transition-transform duration-[280ms] ease-out group-hover:scale-105 motion-reduce:transition-none" aria-hidden="true" /> : null}
              <span
                className={[
                  COLLAPSIBLE_TEXT_CLASS,
                  'font-medium',
                  collapsed ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-[11rem] translate-x-0 opacity-100',
                ].join(' ')}
                aria-hidden={collapsed}
              >
                {item.label}
              </span>
            </NavLink>
          </li>
        );
      })}
    </ul>
  </nav>
);

const SidebarProfileCard = ({
  collapsed,
  user,
  userData,
  onOpenPreview,
  onOpenUpload,
  onToggleNav,
}) => {
  if (!userData) {
    return (
      <div className={`overflow-hidden rounded-3xl border border-white/10 bg-slate-900/65 px-3 py-3 shadow-xl transition-all duration-[280ms] ease-out motion-reduce:transition-none ${collapsed ? 'flex flex-col items-center gap-3' : 'space-y-3'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className={`${collapsed ? 'h-16 w-16' : 'h-16 w-16'} animate-pulse rounded-full bg-slate-600`} />
          {!collapsed ? (
            <div className="flex-1 space-y-2">
              <div className="h-5 w-24 animate-pulse rounded bg-slate-600" />
              <div className="h-3.5 w-16 animate-pulse rounded bg-slate-700" />
            </div>
          ) : null}
          {!collapsed ? (
            <div className="shrink-0 flex flex-col items-end gap-2">
              <button
                type="button"
                onClick={onToggleNav}
                className={`${ACTION_BUTTON_CLASS} h-9 w-9 shrink-0`}
                aria-label="Collapse navigation"
                title="Collapse navigation"
                data-testid="layout-sidebar-toggle"
              >
                <GoSidebarCollapse className="text-base" />
              </button>
              <ProfileActions
                canPreview={false}
                compact={false}
                onOpenPreview={onOpenPreview}
                onOpenUpload={onOpenUpload}
                className="justify-end"
                buttonClassName="h-8 w-8"
                iconClassName="text-sm"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={onToggleNav}
              className={`${ACTION_BUTTON_CLASS} h-10 w-10 shrink-0`}
              aria-label="Expand navigation"
              title="Expand navigation"
              data-testid="layout-sidebar-toggle"
            >
              <GoSidebarExpand className="text-lg" />
            </button>
          )}
        </div>
        {collapsed ? (
          <ProfileActions canPreview={false} compact onOpenPreview={onOpenPreview} onOpenUpload={onOpenUpload} />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-3xl border border-white/10 bg-slate-900/65 px-3 py-3 shadow-xl shadow-black/30 backdrop-blur-sm transition-all duration-[280ms] ease-out motion-reduce:transition-none ${collapsed ? 'flex flex-col items-center gap-3' : 'space-y-3'}`}>
      <div className={`flex ${collapsed ? 'w-full flex-col items-center gap-3 text-center' : 'items-start justify-between gap-3'}`}>
        <div className={`flex min-w-0 ${collapsed ? 'flex-col items-center gap-3' : 'flex-col items-center gap-2'}`}>
          <div className="relative shrink-0">
            <Avatar
              user={user}
              userData={userData}
              className={collapsed ? 'h-16 w-16' : 'h-20 w-20'}
            />
          </div>
          {!collapsed ? (
            <ProfileActions
              canPreview={!!userData?.imageUrl}
              compact={false}
              onOpenPreview={onOpenPreview}
              onOpenUpload={onOpenUpload}
              className="justify-center"
              buttonClassName="h-8 w-8"
              iconClassName="text-sm"
            />
          ) : null}
        </div>
        {!collapsed ? (
          <div className="shrink-0 flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={onToggleNav}
              className={`${ACTION_BUTTON_CLASS} h-9 w-9 shrink-0`}
              aria-label="Collapse navigation"
              title="Collapse navigation"
              data-testid="layout-sidebar-toggle"
            >
              <GoSidebarCollapse className="text-base" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleNav}
            className={`${ACTION_BUTTON_CLASS} h-10 w-10 shrink-0`}
            aria-label="Expand navigation"
            title="Expand navigation"
            data-testid="layout-sidebar-toggle"
          >
            <GoSidebarExpand className="text-lg" />
          </button>
        )}
      </div>
      <div
        className={[
          COLLAPSIBLE_TEXT_CLASS,
          'w-full text-center',
          collapsed ? 'max-h-0 max-w-0 -translate-y-2 opacity-0' : 'max-h-16 max-w-full translate-y-0 opacity-100',
        ].join(' ')}
        aria-hidden={collapsed}
      >
        <h1 className="truncate text-xl font-bold leading-tight text-white" title={buildProfileImageLabel(user, userData)}>
          {buildProfileImageLabel(user, userData)}
        </h1>
        <p className="mt-0.5 truncate text-sm text-slate-300">
          {userData?.race || 'No Race'}
        </p>
      </div>
      {collapsed ? (
        <ProfileActions
          canPreview={!!userData?.imageUrl}
          compact
          onOpenPreview={onOpenPreview}
          onOpenUpload={onOpenUpload}
        />
      ) : null}
    </div>
  );
};

const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, userData } = useAuth();
  const {
    closeMobileNav,
    dimensions,
    isDesktop,
    isMobileNavOpen,
    isNavCollapsed,
    navInlineSize,
    openMobileNav,
    toggleNav,
  } = useShellLayout();

  // Loading state for logout operations
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const role = userData?.role;
  const navItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
  const activeRouteLabel = useMemo(() => (
    NAV_ITEMS.find((item) => item.path === location.pathname)?.label || 'Navigation'
  ), [location.pathname]);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      closeMobileNav();
      await signOut(auth);
      // AuthContext will handle clearing localStorage and state
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const openUploadModal = () => {
    closeMobileNav();
    setUploadError('');
    setSelectedFile(null);
    setIsUploadOpen(true);
  };

  const openPreviewModal = () => {
    if (!userData?.imageUrl) {
      return;
    }

    closeMobileNav();
    setIsPreviewOpen(true);
  };

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0] || null);
    setUploadError('');
  };

  const handleUpload = async () => {
    if (!selectedFile || !user) return;
    setIsUploading(true);
    // delete old image
    if (userData?.imagePath) {
      try {
        await deleteObject(storageRef(storage, userData.imagePath));
      } catch (err) {
        console.error('Old image deletion failed:', err);
      }
    }
    // upload new image
    try {
      // construct filename same as CharacterCreation: characterId_uid_timestamp
      const characterId = userData?.characterId || (user && user.email.split('@')[0]);
      const safeName = characterId.replace(/\s+/g, '_');
      const safeFileName = `${safeName}_${user.uid}_${Date.now()}`;
      const imagePath = `characters/${safeFileName}`;
      const fileRef = storageRef(storage, imagePath);
      await uploadBytes(fileRef, selectedFile);
      const url = await getDownloadURL(fileRef);
      // update both URL and storage path
      await updateDoc(doc(db, 'users', user.uid), { imageUrl: url, imagePath });
      setIsUploadOpen(false);
      setSelectedFile(null);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      {isDesktop ? (
        <aside
          data-navbar
          className="sticky top-0 flex h-screen flex-col overflow-hidden border-r border-white/10 bg-[rgba(20,20,32,0.88)] backdrop-blur-md transition-[width] duration-[280ms] ease-out motion-reduce:transition-none"
          style={{
            width: `${navInlineSize}px`,
          }}
        >
        <div className="flex h-full flex-col gap-4 px-2.5 py-4 transition-[width] duration-[280ms] ease-out motion-reduce:transition-none">
            <SidebarProfileCard
              collapsed={isNavCollapsed}
              user={user}
              userData={userData}
              onOpenPreview={openPreviewModal}
              onOpenUpload={openUploadModal}
              onToggleNav={toggleNav}
            />

            <NavList collapsed={isNavCollapsed} navItems={navItems} onNavigate={noop} />

            <button
              type="button"
              className={[
                BASE_NAV_ITEM_CLASS,
                'mt-auto',
                'border-red-400/25 bg-red-500/10 text-red-100 hover:border-red-300/50 hover:bg-red-500/20',
                isNavCollapsed ? 'justify-center px-3 py-3' : 'gap-3 px-4 py-3',
              ].join(' ')}
              onClick={handleLogout}
              disabled={isLoggingOut}
              title={isNavCollapsed ? 'Logout' : undefined}
              aria-label={isNavCollapsed ? 'Logout' : undefined}
            >
              <FiLogOut className="shrink-0 text-[1.2rem]" aria-hidden="true" />
              <span
                className={[
                  COLLAPSIBLE_TEXT_CLASS,
                  'font-medium',
                  isNavCollapsed ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-[10rem] translate-x-0 opacity-100',
                ].join(' ')}
                aria-hidden={isNavCollapsed}
              >
                {isLoggingOut ? 'Logging out...' : 'Logout'}
              </span>
            </button>
          </div>
        </aside>
      ) : (
        <>
          <header
            data-navbar
            className="sticky top-0 z-50 border-b border-white/10 bg-[rgba(22,22,36,0.92)] backdrop-blur-md"
            style={{ height: `${dimensions.mobileTopInset}px` }}
          >
            <div className="flex h-full items-center justify-between gap-3 px-4">
              <div className="min-w-0 flex items-center gap-3">
                <div className="relative shrink-0">
                  <Avatar user={user} userData={userData} className="h-11 w-11" imageClassName="shadow-md" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs uppercase tracking-[0.24em] text-slate-400">
                    {activeRouteLabel}
                  </p>
                  <p className="truncate text-sm font-semibold text-white">
                    {buildProfileImageLabel(user, userData)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openMobileNav}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white transition-colors duration-200 hover:bg-white/10"
                aria-label="Open navigation menu"
                title="Open navigation menu"
                data-testid="mobile-nav-trigger"
              >
                <FiMenu className="text-xl" />
              </button>
            </div>
          </header>

          <div
            className={`fixed inset-0 z-[70] ${isMobileNavOpen ? '' : 'pointer-events-none'}`}
            aria-hidden={!isMobileNavOpen}
            hidden={!isMobileNavOpen}
          >
            <button
              type="button"
              onClick={closeMobileNav}
              className={`absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-[280ms] ease-out motion-reduce:transition-none ${
                isMobileNavOpen ? 'opacity-100' : 'opacity-0'
              }`}
              aria-label="Close navigation menu"
              data-testid="mobile-nav-backdrop"
            />
            <aside
              className={`relative flex h-full max-w-[88vw] flex-col border-r border-white/10 bg-[rgba(20,20,32,0.97)] px-3 py-4 shadow-2xl transition-transform duration-[280ms] ease-out motion-reduce:transition-none ${
                isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
              style={{ width: `${dimensions.mobileDrawerWidth}px` }}
              data-testid="mobile-nav-drawer"
            >
              <div className="flex items-start justify-between gap-3 rounded-3xl border border-white/10 bg-slate-900/65 px-4 py-4 shadow-xl shadow-black/30 backdrop-blur-sm">
                <div className="min-w-0 flex items-center gap-3">
                  <div className="relative shrink-0">
                    <Avatar user={user} userData={userData} className="h-14 w-14" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="truncate text-lg font-bold text-white">
                      {buildProfileImageLabel(user, userData)}
                    </h1>
                    <p className="truncate text-sm text-slate-300">
                      {userData?.race || 'No Race'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeMobileNav}
                  className={`${ACTION_BUTTON_CLASS} h-10 w-10 shrink-0`}
                  aria-label="Close navigation menu"
                  title="Close navigation menu"
                >
                  <FiX className="text-lg" />
                </button>
              </div>

              <div className="mt-3 flex justify-end rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3">
                <ProfileActions
                  canPreview={!!userData?.imageUrl}
                  compact={false}
                  onOpenPreview={openPreviewModal}
                  onOpenUpload={openUploadModal}
                />
              </div>

              <div className="mt-4 flex flex-1 flex-col">
                <NavList collapsed={false} navItems={navItems} onNavigate={closeMobileNav} />

                <button
                  type="button"
                  className="mt-auto flex w-full items-center gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-red-100 transition-colors duration-200 hover:border-red-300/50 hover:bg-red-500/20"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                >
                  <FiLogOut className="shrink-0 text-[1.2rem]" aria-hidden="true" />
                  <span className="truncate font-medium">{isLoggingOut ? 'Logging out...' : 'Logout'}</span>
                </button>
              </div>
            </aside>
          </div>
        </>
      )}

      {isPreviewOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setIsPreviewOpen(false)}
        >
          <img
            src={userData?.imageUrl}
            alt="Profile Preview"
            className="max-w-full max-h-full rounded-lg"
          />
        </div>
      )}
      {isUploadOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black bg-opacity-75">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm">
            <h2 className="text-xl text-white mb-4">Upload New Profile Image</h2>
            <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
              <p className="text-white">Uploading a new image will permanently delete your previous one.</p>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="block w-full text-white mb-4"
            />
            {uploadError && <p className="text-red-500 mb-2">{uploadError}</p>}
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => { setIsUploadOpen(false); setSelectedFile(null); }}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                disabled={isUploading}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
