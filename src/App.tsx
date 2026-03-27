/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useEffect, useCallback, Component } from 'react';
import { 
  Calendar, 
  ShoppingBasket, 
  ShoppingCart, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Clock, 
  Coins, 
  ChevronRight, 
  ChevronLeft,
  CheckCircle2,
  Package,
  TrendingDown,
  Info,
  Star,
  MessageSquare,
  Heart,
  Users,
  UserPlus,
  ExternalLink,
  LogOut,
  Mail,
  Lock,
  AlertTriangle,
  Image as ImageIcon,
  Camera,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from './lib/supabase';
import { apiFetch } from './lib/api';
import { MealPlanItem, Recipe, MealType, Review, Favorite, UserProfile } from './types';
import { generateWeeklyPlan, comparePrices, regenerateSingleMeal } from './services/gemini';

// App Constants
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    const state = (this as any).state;
    if (state.hasError) {
      let message = "Something went wrong.";
      let isPermissionError = false;

      if (state.error?.message === "GEMINI_PERMISSION_DENIED") {
        isPermissionError = true;
        message = "Gemini API Permission Denied. This usually means an API key needs to be selected or the current key lacks permissions. Please select a valid Gemini API key to continue.";
      } else {
        try {
          const parsed = JSON.parse(state.error.message);
          if (parsed.error) message = `Database Error: ${parsed.error}`;
        } catch (e) {
          message = state.error.message || message;
        }
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-100 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-stone-900 mb-2">
              {isPermissionError ? "API Key Required" : "Unexpected Error"}
            </h2>
            <p className="text-stone-600 mb-6">{message}</p>
            
            {isPermissionError ? (
              <div className="space-y-3">
                <button 
                  onClick={async () => {
                    if ((window as any).aistudio?.openSelectKey) {
                      await (window as any).aistudio.openSelectKey();
                      window.location.reload();
                    } else {
                      alert("API Key selection is only available in the AI Studio environment.");
                    }
                  }}
                  className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Key size={18} />
                  Select API Key
                </button>
                <p className="text-[10px] text-stone-400">
                  Note: Please select a key from a paid Google Cloud project. 
                  <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline ml-1">Learn more about billing.</a>
                </p>
              </div>
            ) : (
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors"
              >
                Reload Application
              </button>
            )}
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

function MainApp() {
  const [activeTab, setActiveTab] = useState<'planner' | 'shopping' | 'favorites' | 'profiles'>('planner');
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingType, setLoadingType] = useState<'plan' | 'comparison' | 'single' | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [selectedMealInfo, setSelectedMealInfo] = useState<{day: number, type: MealType} | null>(null);
  const [budget, setBudget] = useState(60);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(2);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showShoppingAssistant, setShowShoppingAssistant] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if ((window as any).aistudio?.hasSelectedApiKey) {
        const selected = await (window as any).aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(true);
      }
    };
    checkKey();
  }, []);

  console.log("MainApp rendering. AuthReady:", isAuthReady, "User:", user);

  const saveSettings = async (b: number, a: number, c: number) => {
    if (!user) return;
    try {
      await apiFetch('/api/user/settings', {
        method: 'POST',
        body: JSON.stringify({ budget: b, adults: a, children: c })
      });
    } catch (e) {
      console.error("Failed to save settings", e);
    }
  };

  const saveCheckedItems = async (items: string[]) => {
    if (!user) return;
    try {
      await apiFetch('/api/user/checked-items', {
        method: 'POST',
        body: JSON.stringify({ items })
      });
    } catch (e) {
      console.error("Failed to save checked items", e);
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
      }
      setIsAuthReady(true);
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (toast) {
      const duration = toast.message.includes("Session lost") ? 10000 : 3000;
      const timer = setTimeout(() => setToast(null), duration);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<UserProfile | null>(null);
  const [filters, setFilters] = useState<string[]>(['budget meals', 'kid friendly']);
  const [comparison, setComparison] = useState<any>(null);
  const [comparisonBudget, setComparisonBudget] = useState<number | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState('');
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [manualItems, setManualItems] = useState<{id: string, name: string, amount: string, unit: string, category: string}[]>([]);

  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user || !isAuthReady) return;
    
    try {
      // Fetch settings
      const settingsRes = await apiFetch('/api/user/settings');
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setBudget(data.budget || 60);
        setAdults(data.adults || 2);
        setChildren(data.children || 2);
        setCheckedItems(data.checked_items || []);
      }

      // Fetch other data
      const [profilesRes, mealPlanRes, favoritesRes, shoppingRes] = await Promise.all([
        apiFetch('/api/profiles'),
        apiFetch('/api/meal-plan'),
        apiFetch('/api/favorites'),
        apiFetch('/api/shopping-items')
      ]);

      if (profilesRes.status === 401 || mealPlanRes.status === 401 || favoritesRes.status === 401 || shoppingRes.status === 401) {
        console.warn("Session expired. Clearing user state.");
        await supabase.auth.signOut();
        setUser(null);
        setToast({ 
          message: "Session expired. Please log in again.", 
          type: 'error' 
        });
        setTimeout(() => setToast(null), 5000);
        return;
      }

      if (profilesRes.ok) setProfiles(await profilesRes.json());
      if (mealPlanRes.ok) setMealPlan(await mealPlanRes.json());
      if (favoritesRes.ok) setFavorites(await favoritesRes.json());
      if (shoppingRes.ok) setManualItems(await shoppingRes.json());

    } catch (error) {
      console.error("Failed to fetch data", error);
    }
  }, [user, isAuthReady]);

  useEffect(() => {
    if (user && isAuthReady) {
      fetchData();
    }
  }, [user, isAuthReady, fetchData]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (data.user) {
          setToast({ message: "Welcome to Basket Wise! Please check your email for verification.", type: 'success' });
        }
      } else if (authMode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (data.user) {
          setToast({ message: "Welcome back!", type: 'success' });
        }
      } else if (authMode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(authEmail);
        if (error) throw error;
        setToast({ message: "Password reset email sent!", type: 'success' });
        setAuthMode('login');
      }
    } catch (e: any) {
      let message = e.message || "Authentication failed";
      if (message.includes("Email not confirmed")) {
        message = "Please verify your email address before logging in. Check your inbox for the confirmation link.";
      } else if (message.includes("Invalid login credentials")) {
        message = "Incorrect email or password. Please try again.";
      }
      setToast({ message, type: 'error' });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMealPlan([]);
    setFavorites([]);
    setProfiles([]);
    setManualItems([]);
    setCheckedItems([]);
    setBudget(60);
    setAdults(2);
    setChildren(2);
    setToast({ message: "Logged out successfully", type: 'success' });
  };

  useEffect(() => {
    if (selectedRecipe) {
      fetchReviews(selectedRecipe.title); // Using title as ID for simplicity in this prototype
    }
  }, [selectedRecipe]);

  const fetchReviews = async (recipeId: string) => {
    try {
      const res = await apiFetch(`/api/reviews/${recipeId}`);
      if (res.ok) {
        setReviews(await res.json());
      }
    } catch (error) {
      console.error("Failed to fetch reviews", error);
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipe || !user) return;

    try {
      const res = await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          recipeId: selectedRecipe.title,
          rating: newRating,
          comment: newComment
        })
      });
      if (res.ok) {
        fetchReviews(selectedRecipe.title);
        setNewComment('');
        setNewRating(5);
      }
    } catch (error) {
      console.error("Failed to submit review", error);
    }
  };

  const handleGeminiError = async (error: any) => {
    if (error instanceof Error && error.message === "GEMINI_PERMISSION_DENIED") {
      setToast({ 
        message: "Gemini API permission denied. Please select a valid API key.", 
        type: 'error' 
      });
      if (window.aistudio?.openSelectKey) {
        await window.aistudio.openSelectKey();
      }
    } else {
      setToast({ 
        message: "Failed to connect to Gemini. Please try again.", 
        type: 'error' 
      });
    }
  };

  const handleRegenerateMeal = async () => {
    if (!selectedMealInfo || !user) return;
    setLoading(true);
    setLoadingType('single');
    try {
      const newRecipe = await regenerateSingleMeal(
        selectedMealInfo.day,
        selectedMealInfo.type,
        filters,
        budget,
        adults,
        children,
        profiles
      );
      
      // Update local state
      const newPlan = mealPlan.map(m => 
        (m.day === selectedMealInfo.day && m.mealType === selectedMealInfo.type) 
        ? { ...m, recipe: newRecipe } 
        : m
      );
      setMealPlan(newPlan);
      setSelectedRecipe(newRecipe);
      setComparison(null);
      setToast({ message: "Meal updated and shopping list refreshed!", type: 'success' });

      // Update via API
      await apiFetch('/api/meal-plan', {
        method: 'POST',
        body: JSON.stringify({ items: newPlan })
      });
    } catch (error) {
      console.error("Failed to regenerate meal", error);
      handleGeminiError(error);
    } finally {
      setLoading(false);
      setLoadingType(null);
    }
  };

  const handleGeneratePlan = async () => {
  if (!user) return;

  setLoading(true);

  try {
    const handleGeneratePlan = async () => {
  if (!user) return;

  setLoading(true);

  try {
    const { data, error } = await supabase.functions.invoke(
  'meal-plan-final-v1'
);

    console.log('EDGE FUNCTION DATA:', data);
    console.log('EDGE FUNCTION ERROR:', error);

    if (error) throw error;

    setToast({
      message: 'Recipes generated!',
      type: 'success'
    });
  } catch (error: any) {
    console.error('Failed to generate plan', error);
    setToast({
      message: error.message || 'Failed to call function',
      type: 'error'
    });
  } finally {
    setLoading(false);
    setLoadingType(null);
  }
};
      
      if (user) {
        await apiFetch('/api/meal-plan', {
          method: 'POST',
          body: JSON.stringify({ items: newPlan })
        });
      }
      
      setMealPlan(newPlan);
      setCheckedItems([]);
      saveCheckedItems([]);
      setComparison(null);
      setToast({ message: "New weekly plan generated and shopping list updated!", type: 'success' });
      
    } catch (error: any) {
      console.error("Failed to generate plan", error);
      Gemini
    } finally {
      setLoading(false);
      setLoadingType(null);
    }
  };

  const handleSaveProfile = async (profile: UserProfile) => {
    if (!user) return;
    try {
      if (editingProfile && editingProfile.id) {
        await apiFetch(`/api/profiles/${editingProfile.id}`, {
          method: 'PUT',
          body: JSON.stringify(profile)
        });
      } else {
        await apiFetch('/api/profiles', {
          method: 'POST',
          body: JSON.stringify(profile)
        });
      }
      fetchData();
      setShowProfileModal(false);
      setEditingProfile(null);
    } catch (error) {
      console.error("Failed to save profile", error);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      await apiFetch(`/api/profiles/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error("Failed to delete profile", error);
    }
  };

  const toggleProfileActive = async (profile: UserProfile) => {
    if (!profile.id) return;
    try {
      await apiFetch(`/api/profiles/${profile.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...profile, isActive: !profile.isActive })
      });
      fetchData();
    } catch (error) {
      console.error("Failed to toggle profile", error);
    }
  };

  const toggleFavorite = async (recipe: Recipe) => {
    if (!user || !recipe) return;
    const recipeTitle = (recipe.title || '').trim().toLowerCase();
    if (!recipeTitle) {
      setToast({ message: "Cannot favorite recipe without a title", type: 'error' });
      return;
    }

    const favorite = favorites.find(f => {
      const fId = (f.recipeId || '').trim().toLowerCase();
      return fId === recipeTitle;
    });
    
    try {
      if (favorite) {
        const res = await apiFetch(`/api/favorites/${favorite.id}`, { method: 'DELETE' });
        if (res.status === 401) {
          setUser(null);
          localStorage.removeItem('bw_token');
          setToast({ message: "Session expired. Please login again.", type: 'error' });
          return;
        }
        if (res.ok) {
          setToast({ message: "Removed from favorites", type: 'success' });
          // Optimistic update
          setFavorites(prev => prev.filter(f => f.id !== favorite.id));
        } else {
          const err = await res.json();
          throw new Error(err.error || "Failed to remove favorite");
        }
      } else {
        const res = await apiFetch('/api/favorites', {
          method: 'POST',
          body: JSON.stringify({ recipeId: recipeTitle, recipe })
        });
        if (res.status === 401) {
          setUser(null);
          localStorage.removeItem('bw_token');
          setToast({ message: "Session expired. Please login again.", type: 'error' });
          return;
        }
        if (res.ok) {
          const newFav = await res.json();
          setToast({ message: "Added to favorites", type: 'success' });
          // Optimistic update
          setFavorites(prev => [...prev, newFav]);
        } else {
          const err = await res.json();
          throw new Error(err.error || "Failed to add favorite");
        }
      }
      fetchData();
    } catch (error: any) {
      console.error("Failed to toggle favorite", error);
      setToast({ message: error.message || "Failed to update favorites", type: 'error' });
    }
  };

  const getShoppingList = () => {
    const ingredients: any = {};
    mealPlan.forEach(item => {
      // Skip recipes that are leftovers
      if (item.recipe.title.toLowerCase().includes('leftover')) {
        return;
      }
      
      item.recipe.ingredients.forEach(ing => {
        const key = `${ing.name.toLowerCase()}-${ing.unit}`;
        if (ingredients[key]) {
          const currentAmount = parseFloat(ingredients[key].amount);
          const newAmount = parseFloat(ing.amount);
          
          if (!isNaN(currentAmount) && !isNaN(newAmount)) {
            ingredients[key].amount = (currentAmount + newAmount).toString();
          } else {
            // If one is not a number, just append or keep as is
            ingredients[key].amount = `${ingredients[key].amount} + ${ing.amount}`;
          }
        } else {
          ingredients[key] = { ...ing };
        }
      });
    });

    // Add manual items
    manualItems.forEach(item => {
      const key = `manual-${item.id}`;
      ingredients[key] = { ...item, isManual: true };
    });

    return Object.values(ingredients);
  };

  const getGroupedShoppingList = () => {
    const list = getShoppingList();
    const grouped: { [key: string]: any[] } = {};
    
    list.forEach((item: any) => {
      const category = item.category || 'Other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(item);
    });
    
    return grouped;
  };

  const handleComparePrices = async () => {
    setLoading(true);
    setLoadingType('comparison');
    try {
      const result = await comparePrices(getShoppingList(), budget);
      setComparison(result);
      setComparisonBudget(budget);
    } catch (error: any) {
      console.error("Failed to compare prices", error);
      handleGeminiError(error);
    } finally {
      setLoading(false);
      setLoadingType(null);
    }
  };

  const toggleChecked = (itemName: string) => {
    const newChecked = checkedItems.includes(itemName) 
      ? checkedItems.filter(i => i !== itemName) 
      : [...checkedItems, itemName];
    setCheckedItems(newChecked);
    saveCheckedItems(newChecked);
  };

  const handleAddManualItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = formData.get('name') as string;
    if (!name) return;

    const newItem = {
      name: name,
      amount: formData.get('amount') as string || '1',
      unit: '',
      category: formData.get('category') as string || 'Cupboard'
    };

    try {
      await apiFetch('/api/shopping-items', {
        method: 'POST',
        body: JSON.stringify(newItem)
      });
      fetchData();
      form.reset();
    } catch (error) {
      console.error("Failed to add manual item", error);
    }
  };

  const handleRemoveManualItem = async (id: string) => {
    try {
      await apiFetch(`/api/shopping-items/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error("Failed to remove manual item", error);
    }
  };

  const handleSendBasket = (supermarket: string) => {
    // Open supermarket website directly without copying to clipboard
    const urls: { [key: string]: string } = {
      'Tesco': 'https://www.tesco.com/groceries/en-GB/quick-add',
      'Asda': 'https://groceries.asda.com/search/',
      'Sainsbury\'s': 'https://www.sainsburys.co.uk/gol-ui/SearchResults/',
      'Morrisons': 'https://groceries.morrisons.com/search?entry=',
      'Aldi': 'https://www.aldi.co.uk/search?text=',
      'Lidl': 'https://www.lidl.co.uk/',
      'Waitrose': 'https://www.waitrose.com/ecom/shop/quick-add',
      'Ocado': 'https://www.ocado.com/search?entry='
    };
    
    const baseUrl = urls[supermarket] || `https://www.google.com/search?q=${supermarket}+groceries+`;
    window.open(baseUrl, '_blank');
    setToast({ message: `Opening ${supermarket} website...`, type: 'success' });
  };

  const handleWhatsAppShare = () => {
    const list = getShoppingList();
    const listText = `🛒 *My Basket Wise Shopping List*\n\n` + 
      list.map((i: any) => `• ${i.amount} ${i.unit || ''} ${i.name}`).join('\n') +
      `\n\nGenerated by Basket Wise`;
    
    const url = `https://wa.me/?text=${encodeURIComponent(listText)}`;
    window.open(url, '_blank');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setToast({ message: `Copied: ${text}`, type: 'success' });
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#f0fdf4] flex flex-col items-center justify-center gap-4">
        <RefreshCw className="animate-spin text-[#15803d]" size={48} />
        <p className="text-sm font-bold text-[#15803d] animate-pulse">Initializing Basket Wise...</p>
      </div>
    );
  }

  if (!user) {
    const isSupabaseConfigured = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

    return (
      <div className="min-h-screen bg-[#f0fdf4] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden border border-[#dcfce7]"
        >
          <div className="bg-[#15803d] p-8 text-white text-center">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-md">
              <ShoppingBasket size={32} />
            </div>
            <h1 className="text-3xl font-serif font-bold mb-2">Basket Wise</h1>
            <p className="text-white/70 text-sm">Smart Meal Planning & Budgeting</p>
          </div>
          
          <div className="p-8">
            {!isSupabaseConfigured && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                <div>
                  <p className="text-xs font-bold text-amber-800 mb-1">Backend Configuration Required</p>
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    Please set your Supabase credentials in the AI Studio Secrets panel to enable login and data persistence.
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-4 mb-8 p-1 bg-[#f0fdf4] rounded-2xl">
              <button 
                onClick={() => setAuthMode('login')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${authMode === 'login' ? 'bg-white text-[#15803d] shadow-sm' : 'text-[#15803d]/40'}`}
              >
                Login
              </button>
              <button 
                onClick={() => setAuthMode('register')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${authMode === 'register' ? 'bg-white text-[#15803d] shadow-sm' : 'text-[#15803d]/40'}`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              {user && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4">
                  <p className="text-[10px] text-blue-700 leading-tight font-bold">
                    Logged in as {user.email}. 
                    <button onClick={() => window.location.reload()} className="ml-2 underline">Click here to refresh</button>
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#15803d]/60 ml-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[#15803d]/40" size={18} />
                  <input 
                    type="email" 
                    required 
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-[#f0fdf4] border-none rounded-2xl py-3.5 pl-12 pr-4 focus:ring-2 focus:ring-[#15803d]/20 transition-all text-sm"
                  />
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] uppercase font-bold text-[#15803d]/60">
                    {authMode === 'reset' ? 'New Password' : 'Password'}
                  </label>
                  {authMode === 'login' && (
                    <button 
                      type="button"
                      onClick={() => setAuthMode('reset')}
                      className="text-[10px] uppercase font-bold text-[#15803d]/40 hover:text-[#15803d] transition-colors"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[#15803d]/40" size={18} />
                  <input 
                    type="password" 
                    required 
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[#f0fdf4] border-none rounded-2xl py-3.5 pl-12 pr-4 focus:ring-2 focus:ring-[#15803d]/20 transition-all text-sm"
                  />
                </div>
              </div>

              <button 
                type="submit" 
                disabled={authLoading}
                className="w-full bg-[#15803d] text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-[#166534] transition-all flex items-center justify-center gap-2 mt-4"
              >
                {authLoading ? <RefreshCw className="animate-spin" size={20} /> : (
                  authMode === 'login' ? 'Sign In' : 
                  authMode === 'register' ? 'Create Account' : 
                  'Reset Password'
                )}
              </button>

              {authMode === 'login' && (
                <p className="text-center text-xs text-[#15803d]/60 mt-4">
                  Don't have an account? {' '}
                  <button 
                    type="button"
                    onClick={() => setAuthMode('register')}
                    className="font-bold underline hover:text-[#15803d]"
                  >
                    Register here
                  </button>
                </p>
              )}

              {authMode === 'register' && (
                <p className="text-center text-xs text-[#15803d]/60 mt-4">
                  Already have an account? {' '}
                  <button 
                    type="button"
                    onClick={() => setAuthMode('login')}
                    className="font-bold underline hover:text-[#15803d]"
                  >
                    Sign in here
                  </button>
                </p>
              )}
              
              {authMode === 'reset' && (
                <button 
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className="w-full text-center text-xs font-bold text-[#15803d]/60 mt-4 hover:text-[#15803d] transition-colors"
                >
                  Back to Login
                </button>
              )}
            </form>

            <p className="text-center text-xs text-[#15803d]/40 mt-8 leading-relaxed">
              By continuing, you agree to our <span className="underline cursor-pointer">Terms of Service</span> and <span className="underline cursor-pointer">Privacy Policy</span>.
            </p>
          </div>
        </motion.div>
        
        {/* Toast Notification */}
        <AnimatePresence>
          {toast && (
            <motion.div 
              initial={{ opacity: 0, y: 50, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 50, x: '-50%' }}
              className={`fixed bottom-8 left-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl border flex items-center gap-3 min-w-[300px] ${
                toast.type === 'success' ? 'bg-[#15803d] text-white border-[#166534]' : 'bg-red-500 text-white border-red-600'
              }`}
            >
              {toast.type === 'success' ? <CheckCircle2 size={20} /> : <Info size={20} />}
              <p className="text-sm font-medium">{toast.message}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] text-[#1a1a1a] font-sans pb-20">
      {/* API Key Selection Overlay */}
      {hasKey === false && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-[32px] shadow-2xl max-w-md w-full text-center border border-[#dcfce7]"
          >
            <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Key className="w-10 h-10 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-stone-900 mb-3">API Key Required</h2>
            <p className="text-stone-600 mb-8 text-sm leading-relaxed">
              To use Basket Wise's AI-powered meal planning and price comparison, you need to select an API key from a paid Google Cloud project.
            </p>
            
            <div className="space-y-4">
              <button 
                onClick={async () => {
                  if ((window as any).aistudio?.openSelectKey) {
                    await (window as any).aistudio.openSelectKey();
                    setHasKey(true);
                  }
                }}
                className="w-full py-4 bg-[#15803d] text-white rounded-2xl font-bold hover:bg-[#166534] transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2"
              >
                <Key size={20} />
                Select API Key
              </button>
              
              <a 
                href="https://ai.google.dev/gemini-api/docs/billing" 
                target="_blank" 
                rel="noopener noreferrer"
                className="block text-xs font-bold text-[#15803d]/60 hover:text-[#15803d] transition-colors uppercase tracking-widest"
              >
                Learn about billing
              </a>
            </div>
          </motion.div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-[#dcfce7] px-6 py-4 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="bg-[#15803d] p-1.5 rounded-full">
                <ShoppingBasket className="text-white w-5 h-5" />
              </div>
              <h1 className="text-3xl font-serif font-bold tracking-tight">Basket Wise</h1>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={handleLogout} 
                className="bg-[#15803d] text-white px-4 py-1.5 md:px-6 md:py-2 rounded-full font-medium hover:bg-[#166534] transition-colors flex items-center gap-2 text-xs md:text-sm shadow-sm"
              >
                <LogOut size={16} />
                <span>Logout</span>
              </button>
              <div className="flex gap-4">
                {/* Navigation moved to bottom bar */}
              </div>
            </div>
          </div>
      </header>

      {/* Loading Overlay */}
      <AnimatePresence>
        {loading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white p-8 rounded-[32px] shadow-2xl max-w-sm w-full text-center"
            >
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 border-4 border-[#f0fdf4] rounded-full" />
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-4 border-[#15803d] rounded-full border-t-transparent"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <RefreshCw className="text-[#15803d] animate-pulse" size={32} />
                </div>
              </div>
              <h3 className="text-xl font-serif font-bold text-[#1a1a1a] mb-2">
                {loadingType === 'comparison' 
                  ? 'Generating the cheapest basket for you' 
                  : 'Generating a customized meal plan for you'}
              </h3>
              <p className="text-[#15803d]/60 text-sm leading-relaxed">
                {loadingType === 'comparison' 
                  ? "We won't be long..." 
                  : "It won't be long..."}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-5xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {activeTab === 'planner' && (
            <motion.div 
              key="planner"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-[#dcfce7]">
                <div>
                  <h2 className="text-2xl font-serif font-bold">Weekly Meal Plan</h2>
                  <p className="text-[#15803d]/70">Personalized meals for your family.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button 
                    onClick={() => setShowBudgetModal(true)}
                    className="flex items-center gap-2 bg-[#f0fdf4] px-4 py-2 rounded-full border border-[#dcfce7] hover:bg-[#dcfce7] transition-colors"
                  >
                    <Coins size={16} className="text-[#15803d]" />
                    <span className="text-sm font-medium">Budget: £{budget} • {adults}A, {children}C</span>
                  </button>
                  <button 
                    onClick={handleGeneratePlan}
                    disabled={loading}
                    className="bg-[#15803d] text-white px-6 py-2 rounded-full font-medium hover:bg-[#166534] transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    {mealPlan.length > 0 ? 'Regenerate' : 'Generate Plan'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
                {DAYS.map((day, dayIdx) => (
                  <div key={day} className="space-y-4">
                    <h3 className="text-center font-bold text-sm uppercase tracking-widest text-[#15803d]">{day}</h3>
                    <div className="space-y-3">
                      {MEAL_TYPES.map(type => {
                        const meal = mealPlan.find(m => m.day === dayIdx && m.mealType === type);
                        return (
                          <div 
                            key={type}
                            onClick={() => {
                              if (meal) {
                                setSelectedRecipe(meal.recipe);
                                setSelectedMealInfo({ day: dayIdx, type });
                              }
                            }}
                            className={`p-3 rounded-2xl border transition-all cursor-pointer h-32 flex flex-col justify-between ${meal ? 'bg-white border-[#dcfce7] hover:shadow-md' : 'bg-dashed border-2 border-[#dcfce7] border-dashed opacity-50'}`}
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex-1">
                                <span className="text-[10px] uppercase font-bold text-[#15803d]/60">{type}</span>
                                <p className="text-sm font-medium line-clamp-2 mt-1">{meal?.recipe.title || 'No meal'}</p>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                {meal && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleFavorite(meal.recipe);
                                    }}
                                    className={`p-1 rounded-full transition-colors ${favorites.some(f => (f.recipeId || '').trim().toLowerCase() === meal.recipe.title.trim().toLowerCase()) ? 'text-red-500 bg-red-50' : 'text-[#15803d]/30 hover:bg-[#f0fdf4]'}`}
                                  >
                                    <Heart size={14} fill={favorites.some(f => (f.recipeId || '').trim().toLowerCase() === meal.recipe.title.trim().toLowerCase()) ? "currentColor" : "none"} />
                                  </button>
                                )}
                              </div>
                            </div>
                            {meal && (
                              <div className="flex items-center justify-between mt-auto">
                                <div className="flex items-center gap-2 text-[10px] text-[#15803d]/70">
                                  <Clock size={10} />
                                  <span>{meal.recipe.prepTime + meal.recipe.cookTime}m</span>
                                </div>
                                <div className="bg-[#15803d]/5 border border-[#15803d]/10 px-1.5 py-0.5 rounded text-[8px] font-bold text-[#15803d] uppercase tracking-tighter">
                                  Click for recipe
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'shopping' && (
            <motion.div 
              key="shopping"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#dcfce7]">
                <div className="flex flex-col items-center text-center mb-8 gap-4">
                  <h2 className="text-3xl font-serif font-bold">Shopping List</h2>
                  <div className="flex flex-wrap justify-center gap-3">
                    <button 
                      onClick={() => setShowShoppingAssistant(true)}
                      className="bg-white border border-[#15803d] text-[#15803d] px-4 py-2 rounded-full font-medium hover:bg-[#15803d] hover:text-white transition-all flex items-center gap-2"
                    >
                      <ShoppingCart size={18} />
                      Shopping Assistant
                    </button>
                    <button 
                      onClick={handleWhatsAppShare}
                      className="bg-[#25D366] text-white px-4 py-2 rounded-full font-medium hover:bg-[#128C7E] transition-all flex items-center gap-2"
                    >
                      <MessageSquare size={18} />
                      Send to WhatsApp
                    </button>
                    <button 
                      onClick={handleComparePrices}
                      disabled={loading || mealPlan.length === 0}
                      className="bg-[#15803d] text-white px-6 py-3 rounded-full font-medium hover:bg-[#166534] transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      {loading ? <RefreshCw className="animate-spin" size={18} /> : <TrendingDown size={18} />}
                      Compare Supermarkets
                    </button>
                  </div>
                </div>

                {comparison && (
                  <div className="mb-10 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="col-span-1 md:col-span-2 bg-[#f0fdf4] p-6 rounded-2xl border border-[#dcfce7]">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                        <h3 className="font-bold flex items-center gap-2">
                          <TrendingDown size={18} className="text-[#15803d]" />
                          Price Comparison
                        </h3>
                        <div className="flex items-center gap-3">
                          {comparisonBudget !== null && (
                            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${budget !== comparisonBudget ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                              {budget !== comparisonBudget && <AlertTriangle size={12} />}
                              Target: £{comparisonBudget}
                            </div>
                          )}
                          <span className="text-[10px] text-[#15803d]/40 font-normal uppercase tracking-wider">Powered by trolley.co.uk</span>
                        </div>
                      </div>
                      <div className="space-y-4">
                        {comparison.comparisons.map((comp: any) => (
                          <div key={comp.name} className="flex items-center justify-between py-4 border-b border-[#15803d]/5 last:border-0">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[#15803d] text-sm">{comp.name}</span>
                                {comp.name === comparison.cheapest && (
                                  <span className="text-[8px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Best Value</span>
                                )}
                              </div>
                              <span className={`text-sm ${comp.name === comparison.cheapest ? 'text-[#15803d]' : 'text-[#15803d]/60'}`}>
                                Basket Total: <span className="font-bold">£{comp.totalCost.toFixed(2)}</span>
                              </span>
                            </div>
                            <div className="w-24 flex justify-end">
                              <button 
                                onClick={() => handleSendBasket(comp.name)}
                                className="w-full flex items-center justify-center gap-1.5 bg-white border border-[#dcfce7] px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-[#15803d] hover:text-white hover:border-[#15803d] transition-all group whitespace-nowrap"
                              >
                                <ExternalLink size={14} className="group-hover:scale-110 transition-transform" />
                                Website
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#15803d] text-white p-6 rounded-2xl">
                      <h3 className="font-bold mb-4 flex items-center gap-2">
                        <Info size={18} />
                        Smart Swaps
                      </h3>
                      <div className="space-y-4">
                        {comparison.swaps.map((swap: any, idx: number) => (
                          <div key={idx} className="text-sm border-b border-white/20 pb-2 last:border-0">
                            <p className="opacity-70 line-through">{swap.original}</p>
                            <p className="font-medium">→ {swap.alternative}</p>
                            <p className="text-[10px] text-emerald-300 font-bold mt-1">Save £{swap.savings.toFixed(2)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mb-10 p-6 bg-[#f0fdf4] rounded-2xl border border-[#dcfce7]">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <Plus size={18} className="text-[#15803d]" />
                    Add Extra Items
                  </h3>
                  <form onSubmit={handleAddManualItem} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <input name="name" placeholder="Item name..." required className="bg-white px-4 py-2 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20" />
                    <input name="amount" placeholder="Qty (e.g. 1, 500g)" className="bg-white px-4 py-2 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20" />
                    <select name="category" className="bg-white px-4 py-2 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20">
                      <option>Fruit & Vegetables</option>
                      <option>Meat & Fish</option>
                      <option>Dairy</option>
                      <option>Cupboard</option>
                      <option>Frozen</option>
                    </select>
                    <button type="submit" className="bg-[#15803d] text-white px-6 py-2 rounded-xl font-medium hover:bg-[#166534] transition-colors flex items-center justify-center gap-2">
                      <Plus size={18} /> Add
                    </button>
                  </form>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {Object.entries(getGroupedShoppingList()).sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => {
                    return (
                      <div key={category} className="space-y-4">
                        <h4 className="font-serif font-bold text-lg border-b border-[#dcfce7] pb-2">{category}</h4>
                        <div className="space-y-2">
                          {items.map((item: any, idx: number) => {
                            const isChecked = checkedItems.includes(item.name);
                            return (
                              <div 
                                key={idx} 
                                onClick={() => toggleChecked(item.name)}
                                className={`flex items-center justify-between p-2 hover:bg-[#f0fdf4] rounded-lg transition-colors group cursor-pointer ${isChecked ? 'opacity-50' : ''}`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${isChecked ? 'bg-[#15803d] border-[#15803d]' : 'border-[#15803d]/30 group-hover:border-[#15803d]'}`}>
                                    <CheckCircle2 size={14} className={`text-white transition-opacity ${isChecked ? 'opacity-100' : 'opacity-0'}`} />
                                  </div>
                                  <span className={`font-medium ${isChecked ? 'line-through text-[#15803d]/60' : ''}`}>{item.name}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="text-sm text-[#15803d]/60">
                                    {item.amount}{item.unit ? ` ${item.unit}` : ''}
                                  </span>
                                  {item.isManual && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveManualItem(item.id);
                                      }}
                                      className="text-[#15803d]/20 hover:text-red-500 transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'favorites' && (
            <motion.div 
              key="favorites"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#dcfce7]">
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h2 className="text-3xl font-serif font-bold">Favorite Recipes</h2>
                    <p className="text-[#15803d]/70">These will be prioritized in your next meal plan.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                  {favorites.map(fav => (
                    <div 
                      key={fav.id} 
                      onClick={() => setSelectedRecipe(fav.recipe)}
                      className="bg-[#f0fdf4] p-5 rounded-2xl border border-[#dcfce7] hover:shadow-lg transition-all cursor-pointer group relative"
                    >
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(fav.recipe);
                        }}
                        className="absolute top-4 right-4 p-2 rounded-full bg-white shadow-sm text-red-500 hover:scale-110 transition-transform"
                      >
                        <Heart size={18} fill="currentColor" />
                      </button>
                      <div className="mb-4">
                        <h3 className="font-bold text-lg leading-tight group-hover:text-[#15803d] transition-colors pr-8">{fav.recipe.title}</h3>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {fav.recipe.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-[#dcfce7] uppercase font-bold text-[#15803d]/60">{tag}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm text-[#15803d]/70">
                        <div className="flex items-center gap-1">
                          <Clock size={14} />
                          <span>{fav.recipe.prepTime + fav.recipe.cookTime}m</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Coins size={14} />
                          <span>£{fav.recipe.costPerServing.toFixed(2)}/p</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {favorites.length === 0 && (
                    <div className="col-span-full py-20 text-center text-[#15803d]/40">
                      <Heart size={64} className="mx-auto mb-4 opacity-10" />
                      <p className="text-lg">No favorites yet.</p>
                      <p className="text-sm">Heart recipes in the planner to see them here!</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'profiles' && (
            <motion.div 
              key="profiles"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#dcfce7]">
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h2 className="text-3xl font-serif font-bold">User Profiles</h2>
                    <p className="text-[#15803d]/70">Personalize meal plans for everyone in your household.</p>
                  </div>
                  <button 
                    onClick={() => {
                      setEditingProfile(null);
                      setShowProfileModal(true);
                    }}
                    className="bg-[#15803d] text-white px-6 py-2 rounded-full font-medium hover:bg-[#166534] transition-colors flex items-center gap-2"
                  >
                    <UserPlus size={18} /> Add Profile
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {profiles.map(profile => (
                    <div 
                      key={profile.id} 
                      className={`p-6 rounded-2xl border transition-all ${profile.isActive ? 'bg-white border-[#15803d] shadow-md' : 'bg-[#f0fdf4] border-[#dcfce7] opacity-70'}`}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${profile.isActive ? 'bg-[#15803d]' : 'bg-[#15803d]/40'}`}>
                            {profile.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-bold text-lg">{profile.name}</h3>
                            <span className="text-xs uppercase tracking-widest font-bold text-[#15803d]/60">{profile.dietaryPreference}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              setEditingProfile(profile);
                              setShowProfileModal(true);
                            }}
                            className="p-2 rounded-full hover:bg-[#dcfce7] transition-colors text-[#15803d]/60"
                          >
                            <RefreshCw size={16} />
                          </button>
                          <button 
                            onClick={() => handleDeleteProfile(profile.id)}
                            className="p-2 rounded-full hover:bg-red-50 transition-colors text-red-400"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3 mb-6">
                        {profile.allergies.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-red-500/60 block mb-1">Allergies</span>
                            <div className="flex flex-wrap gap-1">
                              {profile.allergies.map(a => (
                                <span key={a} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-100">{a}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {profile.dislikedIngredients.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-[#15803d]/60 block mb-1">Dislikes</span>
                            <div className="flex flex-wrap gap-1">
                              {profile.dislikedIngredients.map(d => (
                                <span key={d} className="text-[10px] bg-white text-[#15803d] px-2 py-0.5 rounded-full border border-[#dcfce7]">{d}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <button 
                        onClick={() => toggleProfileActive(profile)}
                        className={`w-full py-2 rounded-xl font-bold text-sm transition-all ${profile.isActive ? 'bg-[#15803d] text-white' : 'bg-white text-[#15803d] border border-[#dcfce7]'}`}
                      >
                        {profile.isActive ? 'Active in Plan' : 'Include in Plan'}
                      </button>
                    </div>
                  ))}
                  {profiles.length === 0 && (
                    <div className="col-span-full py-20 text-center text-[#15803d]/40">
                      <Users size={64} className="mx-auto mb-4 opacity-10" />
                      <p className="text-lg">No profiles created yet.</p>
                      <p className="text-sm">Add household members to personalize your meal plans!</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Shopping Assistant Sidebar */}
      <AnimatePresence>
        {showShoppingAssistant && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShoppingAssistant(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-[70] flex flex-col"
            >
              <div className="p-6 border-b border-[#dcfce7] flex justify-between items-center bg-[#15803d] text-white">
                <div>
                  <h2 className="text-xl font-serif font-bold">Shopping Assistant</h2>
                  <p className="text-xs opacity-80">Copy items one-by-one to your basket</p>
                </div>
                <button onClick={() => setShowShoppingAssistant(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <ChevronRight size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <div className="bg-[#f0fdf4] p-4 rounded-2xl border border-[#dcfce7] text-sm leading-relaxed">
                  <p className="font-bold mb-1">How to use:</p>
                  <ol className="list-decimal ml-4 space-y-1 text-[#15803d]/80">
                    <li>Open your supermarket site in another tab</li>
                    <li>Click <strong>Copy</strong> next to an item here</li>
                    <li>Paste into the supermarket's search bar</li>
                    <li>Add to basket and repeat!</li>
                  </ol>
                </div>

                {Object.entries(getGroupedShoppingList()).sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => (
                  <div key={category} className="space-y-3">
                    <h4 className="font-bold text-sm uppercase tracking-widest text-[#15803d]/40 border-b border-[#dcfce7] pb-1">{category}</h4>
                    <div className="space-y-2">
                      {items.map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-[#f0fdf4]/50 rounded-xl border border-[#dcfce7] hover:border-[#15803d]/30 transition-all">
                          <div>
                            <p className="font-bold text-sm">{item.name}</p>
                            <p className="text-xs text-[#15803d]/60">{item.amount} {item.unit || ''}</p>
                          </div>
                          <button 
                            onClick={() => copyToClipboard(`${item.amount} ${item.unit || ''} ${item.name}`)}
                            className="bg-white border border-[#dcfce7] px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-[#15803d] hover:text-white transition-all flex items-center gap-1"
                          >
                            <Package size={14} />
                            Copy
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t border-[#dcfce7] bg-[#f0fdf4]">
                <button 
                  onClick={() => {
                    const listText = getShoppingList().map((i: any) => `${i.amount} ${i.unit || ''} ${i.name}`).join('\n');
                    copyToClipboard(listText);
                  }}
                  className="w-full bg-[#15803d] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg hover:bg-[#166534] transition-all"
                >
                  <Package size={18} />
                  Copy Entire List
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className={`fixed bottom-24 left-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl border flex items-center gap-3 min-w-[300px] ${
              toast.type === 'success' ? 'bg-[#15803d] text-white border-[#166534]' : 'bg-red-500 text-white border-red-600'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <Info size={20} />}
            <p className="text-sm font-medium">{toast.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Budget Modal */}
      <AnimatePresence>
        {showBudgetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowBudgetModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-md overflow-hidden rounded-3xl shadow-2xl flex flex-col"
            >
              <div className="p-8">
                <h2 className="text-2xl font-serif font-bold mb-6">Adjust Household & Budget</h2>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-[#15803d]/60 uppercase tracking-widest mb-2">Weekly Budget (£)</label>
                    <input 
                      type="number" 
                      value={budget || ''} 
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setBudget(0);
                        } else {
                          setBudget(Number(val));
                        }
                      }}
                      placeholder="0"
                      className="w-full bg-[#f0fdf4] px-4 py-3 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20 font-bold text-lg"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-[#15803d]/60 uppercase tracking-widest mb-2">Adults</label>
                      <div className="flex items-center gap-3 bg-[#f0fdf4] p-2 rounded-xl border border-[#dcfce7]">
                        <button onClick={() => setAdults(Math.max(1, adults - 1))} className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-[#dcfce7] hover:bg-[#dcfce7]">-</button>
                        <span className="flex-1 text-center font-bold text-lg">{adults}</span>
                        <button onClick={() => setAdults(adults + 1)} className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-[#dcfce7] hover:bg-[#dcfce7]">+</button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-[#15803d]/60 uppercase tracking-widest mb-2">Children</label>
                      <div className="flex items-center gap-3 bg-[#f0fdf4] p-2 rounded-xl border border-[#dcfce7]">
                        <button onClick={() => setChildren(Math.max(0, children - 1))} className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-[#dcfce7] hover:bg-[#dcfce7]">-</button>
                        <span className="flex-1 text-center font-bold text-lg">{children}</span>
                        <button onClick={() => setChildren(children + 1)} className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-[#dcfce7] hover:bg-[#dcfce7]">+</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-6 border-t border-[#dcfce7] bg-[#f0fdf4] flex justify-end gap-3">
                <button 
                  onClick={() => setShowBudgetModal(false)}
                  className="px-6 py-2 rounded-full font-medium hover:bg-[#dcfce7] transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setShowBudgetModal(false);
                    saveSettings(budget, adults, children);
                    handleGeneratePlan();
                  }}
                  className="bg-[#15803d] text-white px-8 py-2 rounded-full font-medium hover:bg-[#166534] transition-colors"
                >
                  Save & Regenerate
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowProfileModal(false);
                setEditingProfile(null);
              }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-lg overflow-hidden rounded-3xl shadow-2xl flex flex-col"
            >
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const profile: UserProfile = {
                  name: formData.get('name') as string,
                  dietaryPreference: formData.get('dietaryPreference') as any,
                  allergies: (formData.get('allergies') as string).split(',').map(s => s.trim()).filter(Boolean),
                  dislikedIngredients: (formData.get('dislikes') as string).split(',').map(s => s.trim()).filter(Boolean),
                  isActive: editingProfile ? editingProfile.isActive : true
                };
                if (editingProfile) {
                  profile.id = editingProfile.id;
                }
                handleSaveProfile(profile);
              }}>
                <div className="p-8">
                  <h2 className="text-2xl font-serif font-bold mb-6">{editingProfile ? 'Edit Profile' : 'Create Profile'}</h2>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-bold text-[#15803d]/60 uppercase tracking-widest mb-2">Name</label>
                      <input 
                        name="name"
                        defaultValue={editingProfile?.name}
                        required
                        placeholder="e.g. Sarah"
                        className="w-full bg-[#f0fdf4] px-4 py-3 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20 font-medium"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-bold text-[#15803d]/60 uppercase tracking-widest mb-2">Dietary Preference</label>
                      <select 
                        name="dietaryPreference"
                        defaultValue={editingProfile?.dietaryPreference || 'none'}
                        className="w-full bg-[#f0fdf4] px-4 py-3 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20 font-medium"
                      >
                        <option value="none">None / Balanced</option>
                        <option value="vegetarian">Vegetarian</option>
                        <option value="vegan">Vegan</option>
                        <option value="pescatarian">Pescatarian</option>
                        <option value="keto">Keto</option>
                        <option value="paleo">Paleo</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-[#15803d]/60 uppercase tracking-widest mb-2">Allergies (comma separated)</label>
                      <input 
                        name="allergies"
                        defaultValue={editingProfile?.allergies.join(', ')}
                        placeholder="e.g. Peanuts, Shellfish"
                        className="w-full bg-[#f0fdf4] px-4 py-3 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-[#15803d]/60 uppercase tracking-widest mb-2">Disliked Ingredients (comma separated)</label>
                      <input 
                        name="dislikes"
                        defaultValue={editingProfile?.dislikedIngredients.join(', ')}
                        placeholder="e.g. Mushrooms, Olives"
                        className="w-full bg-[#f0fdf4] px-4 py-3 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20 font-medium"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="p-6 border-t border-[#dcfce7] bg-[#f0fdf4] flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => {
                      setShowProfileModal(false);
                      setEditingProfile(null);
                    }}
                    className="px-6 py-2 rounded-full font-medium hover:bg-[#dcfce7] transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="bg-[#15803d] text-white px-8 py-2 rounded-full font-medium hover:bg-[#166534] transition-colors"
                  >
                    Save Profile
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Recipe Modal */}
      <AnimatePresence>
        {selectedRecipe && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setSelectedRecipe(null);
                setSelectedMealInfo(null);
              }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl shadow-2xl flex flex-col"
            >
              <div className="p-8 overflow-y-auto">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-3xl font-serif font-bold mb-2">{selectedRecipe.title}</h2>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-1 text-sm text-[#15803d]/70 bg-[#f0fdf4] px-3 py-1 rounded-full">
                        <Clock size={14} />
                        <span>{selectedRecipe.prepTime + selectedRecipe.cookTime} mins</span>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-[#15803d]/70 bg-[#f0fdf4] px-3 py-1 rounded-full">
                        <Coins size={14} />
                        <span>£{selectedRecipe.costPerServing.toFixed(2)} / serving</span>
                      </div>
                      <button 
                        onClick={handleRegenerateMeal}
                        disabled={loading}
                        className="flex items-center gap-1 text-sm text-white bg-[#15803d] px-3 py-1 rounded-full hover:bg-[#166534] transition-colors disabled:opacity-50"
                      >
                        {loading ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                        <span>Change Meal</span>
                      </button>
                      <button 
                        onClick={() => toggleFavorite(selectedRecipe)}
                        className={`flex items-center gap-1 text-sm px-3 py-1 rounded-full transition-colors ${favorites.some(f => (f.recipeId || '').trim().toLowerCase() === selectedRecipe.title.trim().toLowerCase()) ? 'text-red-500 bg-red-50' : 'text-[#15803d]/70 bg-[#f0fdf4] hover:bg-[#dcfce7]'}`}
                      >
                        <Heart size={14} fill={favorites.some(f => (f.recipeId || '').trim().toLowerCase() === selectedRecipe.title.trim().toLowerCase()) ? "currentColor" : "none"} />
                        <span>{favorites.some(f => (f.recipeId || '').trim().toLowerCase() === selectedRecipe.title.trim().toLowerCase()) ? 'Favorited' : 'Favorite'}</span>
                      </button>
                    </div>
                  </div>
                  <button onClick={() => {
                    setSelectedRecipe(null);
                    setSelectedMealInfo(null);
                  }} className="p-2 hover:bg-[#f0fdf4] rounded-full transition-colors">
                    <Plus className="rotate-45" />
                  </button>
                </div>

                {/* Nutritional Info */}
                {selectedRecipe.nutrition && (
                  <div className="space-y-2 mb-8">
                    <p className="text-xs font-bold text-[#15803d]/60 uppercase tracking-widest ml-1">Nutritional Info (Per Serving)</p>
                    <div className="grid grid-cols-4 gap-4 bg-[#f0fdf4] p-4 rounded-2xl border border-[#dcfce7]">
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Calories</p>
                        <p className="font-bold">{selectedRecipe.nutrition.calories}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Protein</p>
                        <p className="font-bold">{selectedRecipe.nutrition.protein}g</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Carbs</p>
                        <p className="font-bold">{selectedRecipe.nutrition.carbohydrates}g</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Fat</p>
                        <p className="font-bold">{selectedRecipe.nutrition.fat}g</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <h3 className="font-bold text-lg mb-3 border-b border-[#dcfce7] pb-1">Ingredients</h3>
                      <ul className="space-y-2">
                        {selectedRecipe.ingredients.map((ing, idx) => (
                          <li key={idx} className="text-sm flex justify-between">
                            <span>{ing.name}</span>
                            <span className="text-[#15803d]/60">{ing.amount} {ing.unit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <h3 className="font-bold text-lg mb-3 border-b border-[#dcfce7] pb-1">Instructions</h3>
                      <ol className="space-y-4">
                        {selectedRecipe.instructions.map((step, idx) => (
                          <li key={idx} className="text-sm flex gap-3">
                            <span className="font-serif font-bold text-[#15803d]">{idx + 1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>

                {/* Reviews Section */}
                <div className="mt-12 space-y-8">
                  <div className="border-t border-[#dcfce7] pt-8">
                    <h3 className="text-xl font-serif font-bold mb-6 flex items-center gap-2">
                      <MessageSquare size={20} />
                      User Reviews
                    </h3>
                    
                    <form onSubmit={handleReviewSubmit} className="bg-[#f0fdf4] p-6 rounded-2xl border border-[#dcfce7] mb-8">
                      <p className="font-bold mb-4">Leave a Review</p>
                      <div className="flex gap-2 mb-4">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setNewRating(star)}
                            className={`p-1 transition-colors ${star <= newRating ? 'text-yellow-500' : 'text-gray-300'}`}
                          >
                            <Star size={24} fill={star <= newRating ? 'currentColor' : 'none'} />
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="What did you think of this meal?"
                        className="w-full bg-white p-4 rounded-xl border border-[#dcfce7] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20 mb-4 h-24"
                        required
                      />
                      <button type="submit" className="bg-[#15803d] text-white px-6 py-2 rounded-full font-medium hover:bg-[#166534] transition-colors">
                        Submit Review
                      </button>
                    </form>

                    <div className="space-y-4">
                      {reviews.map((review) => (
                        <div key={review.id} className="bg-white p-4 rounded-2xl border border-[#dcfce7]">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star key={star} size={12} className={star <= review.rating ? 'text-yellow-500' : 'text-gray-300'} fill={star <= review.rating ? 'currentColor' : 'none'} />
                              ))}
                            </div>
                            <span className="text-[10px] text-[#15803d]/40">{new Date(review.date).toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm">{review.comment}</p>
                        </div>
                      ))}
                      {reviews.length === 0 && (
                        <p className="text-center text-[#15803d]/40 py-4">No reviews yet. Be the first to review!</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-[#dcfce7] bg-[#f0fdf4] flex justify-end">
                <button 
                  onClick={() => {
                    setSelectedRecipe(null);
                    setSelectedMealInfo(null);
                  }}
                  className="bg-[#15803d] text-white px-8 py-2 rounded-full font-medium hover:bg-[#166534] transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#dcfce7] z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
        <div className="max-w-5xl mx-auto px-6 py-2 flex justify-start gap-2 sm:gap-6">
          <button 
            onClick={() => setActiveTab('planner')} 
            className={`flex flex-col sm:flex-row items-center gap-1 sm:gap-3 px-4 py-2 rounded-2xl transition-all ${activeTab === 'planner' ? 'text-[#15803d] bg-[#f0fdf4]' : 'text-[#15803d]/40 hover:text-[#15803d]/60 hover:bg-[#f0fdf4]/50'}`}
          >
            <Calendar size={24} className="sm:w-5 sm:h-5" />
            <span className="text-[10px] sm:text-sm font-bold">Planner</span>
          </button>
          <button 
            onClick={() => setActiveTab('shopping')} 
            className={`flex flex-col sm:flex-row items-center gap-1 sm:gap-3 px-4 py-2 rounded-2xl transition-all ${activeTab === 'shopping' ? 'text-[#15803d] bg-[#f0fdf4]' : 'text-[#15803d]/40 hover:text-[#15803d]/60 hover:bg-[#f0fdf4]/50'}`}
          >
            <ShoppingCart size={24} className="sm:w-5 sm:h-5" />
            <span className="text-[10px] sm:text-sm font-bold">Shopping</span>
          </button>
          <button 
            onClick={() => setActiveTab('favorites')} 
            className={`flex flex-col sm:flex-row items-center gap-1 sm:gap-3 px-4 py-2 rounded-2xl transition-all ${activeTab === 'favorites' ? 'text-[#15803d] bg-[#f0fdf4]' : 'text-[#15803d]/40 hover:text-[#15803d]/60 hover:bg-[#f0fdf4]/50'}`}
          >
            <Heart size={24} className="sm:w-5 sm:h-5" />
            <span className="text-[10px] sm:text-sm font-bold">Favorites</span>
          </button>
          <button 
            onClick={() => setActiveTab('profiles')} 
            className={`flex flex-col sm:flex-row items-center gap-1 sm:gap-3 px-4 py-2 rounded-2xl transition-all ${activeTab === 'profiles' ? 'text-[#15803d] bg-[#f0fdf4]' : 'text-[#15803d]/40 hover:text-[#15803d]/60 hover:bg-[#f0fdf4]/50'}`}
          >
            <Users size={24} className="sm:w-5 sm:h-5" />
            <span className="text-[10px] sm:text-sm font-bold">Profiles</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
