import React, { useEffect, useState } from 'react';
import { RefreshCw, ShoppingBasket, LogOut, Clock, Coins } from 'lucide-react';
import { supabase } from './lib/supabase';

type MealType = 'breakfast' | 'lunch' | 'dinner';

type Ingredient = {
  name: string;
  amount: string;
  unit: string;
  category: string;
};

type AppRecipe = {
  id?: string;
  title: string;
  description: string;
  prepTime: number;
  cookTime: number;
  costPerServing: number;
  estimatedCost: number;
  servings: number;
  ingredients: Ingredient[];
  instructions: string[];
  imageUrl: string;
  calories?: number;
  tags?: string[];
};

type MealPlanItem = {
  id?: string;
  day: number;
  mealType: MealType;
  recipeId?: string;
  recipe: AppRecipe | null;
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [budget] = useState(60);
  const [adults] = useState(2);
  const [children] = useState(2);

  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [selectedRecipe, setSelectedRecipe] = useState<AppRecipe | null>(null);
  const [selectedMealInfo, setSelectedMealInfo] = useState<{ day: number; type: MealType } | null>(
    null
  );

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setUser(session?.user ?? null);
      setIsAuthReady(true);
    };

    checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (user && isAuthReady) {
      fetchMealPlanItems();
    }
  }, [user, isAuthReady]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);

    try {
      if (authMode === 'register') {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        setToast({ message: 'Account created. Check your email.', type: 'success' });
        setAuthMode('login');
      } else if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        setToast({ message: 'Logged in successfully.', type: 'success' });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(authEmail);
        if (error) throw error;
        setToast({ message: 'Password reset email sent.', type: 'success' });
        setAuthMode('login');
      }
    } catch (err: any) {
      setToast({ message: err?.message || 'Authentication failed.', type: 'error' });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMealPlan([]);
    setSelectedRecipe(null);
    setSelectedMealInfo(null);
    setToast({ message: 'Logged out.', type: 'success' });
  };

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || '';
  };

  const mapRecipe = (rawRecipe: any): AppRecipe => {
    if (!rawRecipe) {
      return {
        title: 'Untitled Recipe',
        description: '',
        prepTime: 10,
        cookTime: 20,
        costPerServing: 0,
        estimatedCost: 0,
        servings: 4,
        ingredients: [],
        instructions: ['No instructions available'],
        imageUrl: '',
        calories: 0,
        tags: [],
      };
    }

    const instructions = Array.isArray(rawRecipe?.instructions)
      ? rawRecipe.instructions
      : Array.isArray(rawRecipe?.steps)
      ? rawRecipe.steps
      : typeof rawRecipe?.instructions === 'string'
      ? rawRecipe.instructions
          .split(/\d+\.\s+/)
          .map((s: string) => s.trim())
          .filter(Boolean)
      : ['No instructions available'];

    const ingredients = Array.isArray(rawRecipe?.ingredients)
      ? rawRecipe.ingredients.map((ing: any) => {
          if (typeof ing === 'string') {
            return {
              name: ing,
              amount: '',
              unit: '',
              category: 'Cupboard',
            };
          }

          return {
            name: ing?.name || 'Ingredient',
            amount: String(ing?.amount ?? ''),
            unit: ing?.unit || '',
            category: ing?.category || 'Cupboard',
          };
        })
      : [];

    const estimatedCost = Number(
      rawRecipe?.estimatedCost ?? rawRecipe?.costPerServing ?? rawRecipe?.estimated_cost ?? 0
    );

    return {
      id: rawRecipe?.id,
      title: rawRecipe?.title || 'Untitled Recipe',
      description: rawRecipe?.description || '',
      prepTime: Number(rawRecipe?.prepTime ?? rawRecipe?.prep_time ?? 10),
      cookTime: Number(rawRecipe?.cookTime ?? rawRecipe?.cook_time ?? 20),
      costPerServing: estimatedCost,
      estimatedCost,
      servings: Number(rawRecipe?.servings ?? 4),
      ingredients,
      instructions,
      imageUrl: rawRecipe?.imageUrl || rawRecipe?.image_url || '',
      calories: Number(rawRecipe?.calories ?? 0),
      tags: Array.isArray(rawRecipe?.tags) ? rawRecipe.tags : [],
    };
  };

  const fetchMealPlanItems = async () => {
    try {
      const token = await getAccessToken();

      const res = await fetch('/api/meal-plan', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load meal plan');
      }

      const mapped: MealPlanItem[] = (data || []).map((item: any) => ({
        id: item.id,
        day: Number(item.day),
        mealType: item.mealType,
        recipeId: item.recipeId,
        recipe: item.recipe ? mapRecipe(item.recipe) : null,
      }));

      setMealPlan(mapped);
    } catch (err: any) {
      console.error('Failed to fetch meal plan', err);
      setToast({ message: err?.message || 'Failed to load meal plan.', type: 'error' });
    }
  };

  const handleGeneratePlan = async () => {
    if (!user || loading) return;

    setLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const token = await getAccessToken();

      const res = await fetch('/api/generate-meal-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          preferences: {
            budget,
            adults,
            children,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to generate meal plan');
      }

      if (Array.isArray(data?.items)) {
        const mapped: MealPlanItem[] = data.items.map((item: any) => ({
          id: item.id,
          day: Number(item.day),
          mealType: item.mealType,
          recipeId: item.recipeId,
          recipe: item.recipe ? mapRecipe(item.recipe) : null,
        }));

        setMealPlan(mapped);
      } else {
      
      }

      setToast({
        message: 'Weekly plan generated successfully.',
        type: 'success',
      });
    } catch (err: any) {
      console.error('Failed to generate plan', err);
      setToast({
        message:
          err?.name === 'AbortError'
            ? 'Request timed out. Check the backend route.'
            : err?.message || 'Failed to generate plan.',
        type: 'error',
      });
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#f0fdf4] flex items-center justify-center">
        <RefreshCw className="animate-spin text-[#15803d]" size={40} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f0fdf4] flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-xl border border-[#dcfce7] overflow-hidden">
          <div className="bg-[#15803d] text-white p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4">
              <ShoppingBasket size={30} />
            </div>
            <h1 className="text-3xl font-serif font-bold">Basket Wise</h1>
            <p className="text-white/80 mt-2 text-sm">Smart meal planning for your family</p>
          </div>

          <div className="p-8">
            <div className="flex gap-2 mb-6 bg-[#f0fdf4] p-1 rounded-2xl">
              <button
                onClick={() => setAuthMode('login')}
                className={`flex-1 py-2 rounded-xl text-sm font-bold ${
                  authMode === 'login' ? 'bg-white text-[#15803d] shadow-sm' : 'text-[#15803d]/50'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setAuthMode('register')}
                className={`flex-1 py-2 rounded-xl text-sm font-bold ${
                  authMode === 'register' ? 'bg-white text-[#15803d] shadow-sm' : 'text-[#15803d]/50'
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-[#f0fdf4] px-4 py-3 rounded-2xl border border-[#dcfce7] outline-none"
              />

              <input
                type="password"
                required={authMode !== 'reset'}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Password"
                className="w-full bg-[#f0fdf4] px-4 py-3 rounded-2xl border border-[#dcfce7] outline-none"
              />

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-[#15803d] text-white py-3 rounded-2xl font-bold hover:bg-[#166534] transition-colors disabled:opacity-50"
              >
                {authLoading
                  ? 'Please wait...'
                  : authMode === 'login'
                  ? 'Sign In'
                  : authMode === 'register'
                  ? 'Create Account'
                  : 'Reset Password'}
              </button>
            </form>

            <div className="mt-4 text-center">
              {authMode === 'login' ? (
                <button
                  onClick={() => setAuthMode('reset')}
                  className="text-sm text-[#15803d]/70 hover:text-[#15803d]"
                >
                  Forgot password?
                </button>
              ) : (
                <button
                  onClick={() => setAuthMode('login')}
                  className="text-sm text-[#15803d]/70 hover:text-[#15803d]"
                >
                  Back to login
                </button>
              )}
            </div>
          </div>
        </div>

        {toast && (
          <div
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl ${
              toast.type === 'success' ? 'bg-[#15803d] text-white' : 'bg-red-500 text-white'
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] text-[#1a1a1a] pb-10">
      <header className="bg-white border-b border-[#dcfce7] px-6 py-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-[#15803d] p-2 rounded-full">
              <ShoppingBasket className="text-white w-5 h-5" />
            </div>
            <h1 className="text-3xl font-serif font-bold">Basket Wise</h1>
          </div>

          <button
            onClick={handleLogout}
            className="bg-[#15803d] text-white px-5 py-2 rounded-full font-medium hover:bg-[#166534] transition-colors flex items-center gap-2"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      {loading && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="bg-white rounded-3xl p-8 shadow-2xl text-center">
            <RefreshCw className="animate-spin text-[#15803d] mx-auto mb-4" size={36} />
            <p className="font-bold text-lg">Generating your meal plan...</p>
            <p className="text-sm text-[#15803d]/70 mt-2">Please wait a few seconds.</p>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto p-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#dcfce7] flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-serif font-bold">Weekly Meal Plan</h2>
            <p className="text-[#15803d]/70">Personalized meals for your family.</p>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2 bg-[#f0fdf4] px-4 py-2 rounded-full border border-[#dcfce7]">
              <Coins size={16} className="text-[#15803d]" />
              <span className="text-sm font-medium">
                Budget: £{budget} • {adults}A, {children}C
              </span>
            </div>

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
              <h3 className="text-center font-bold text-sm uppercase tracking-widest text-[#15803d]">
                {day}
              </h3>

              <div className="space-y-3">
                {MEAL_TYPES.map((type) => {
                  const meal = mealPlan.find((m) => m.day === dayIdx && m.mealType === type);

                  return (
                    <div
                      key={type}
                      className={`p-3 rounded-2xl border h-40 flex flex-col justify-between ${
                        meal
                          ? 'bg-white border-[#dcfce7] shadow-sm'
                          : 'border-2 border-dashed border-[#dcfce7] opacity-60'
                      }`}
                    >
                      <div>
                        <span className="text-[10px] uppercase font-bold text-[#15803d]/60">
                          {type}
                        </span>
                        <p className="text-sm font-medium mt-1 line-clamp-3">
                          {meal?.recipe?.title || 'No meal'}
                        </p>
                      </div>

                      {meal?.recipe && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2 text-[11px] text-[#15803d]/70">
                            <Clock size={12} />
                            <span>{meal.recipe.prepTime + meal.recipe.cookTime}m</span>
                          </div>

                          <button
                            onClick={() => {
                              setSelectedRecipe(meal.recipe!);
                              setSelectedMealInfo({ day: dayIdx, type });
                            }}
                            className="w-full bg-[#15803d]/5 border border-[#15803d]/20 px-2 py-2 rounded-xl text-[11px] font-bold text-[#15803d] hover:bg-[#15803d] hover:text-white transition-colors"
                          >
                            Click for recipe
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </main>

      {selectedRecipe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setSelectedRecipe(null);
              setSelectedMealInfo(null);
            }}
          />

          <div className="relative bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl p-8 z-10">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-3xl font-serif font-bold mb-2">{selectedRecipe.title}</h2>
                <p className="text-[#15803d]/70">{selectedRecipe.description}</p>
                {selectedMealInfo && (
                  <p className="text-xs text-[#15803d]/50 mt-2 uppercase tracking-widest font-bold">
                    {DAYS[selectedMealInfo.day]} • {selectedMealInfo.type}
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  setSelectedRecipe(null);
                  setSelectedMealInfo(null);
                }}
                className="px-4 py-2 rounded-full bg-[#f0fdf4] hover:bg-[#dcfce7]"
              >
                Close
              </button>
            </div>

            {selectedRecipe.imageUrl && (
              <div className="mb-8">
                <img
                  src={selectedRecipe.imageUrl}
                  alt={selectedRecipe.title}
                  className="w-full h-72 object-cover rounded-2xl border border-[#dcfce7]"
                />
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-[#f0fdf4] p-4 rounded-2xl">
                <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Prep Time</p>
                <p className="font-bold">{selectedRecipe.prepTime} mins</p>
              </div>
              <div className="bg-[#f0fdf4] p-4 rounded-2xl">
                <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Cook Time</p>
                <p className="font-bold">{selectedRecipe.cookTime} mins</p>
              </div>
              <div className="bg-[#f0fdf4] p-4 rounded-2xl">
                <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Servings</p>
                <p className="font-bold">{selectedRecipe.servings}</p>
              </div>
              <div className="bg-[#f0fdf4] p-4 rounded-2xl">
                <p className="text-[10px] uppercase font-bold text-[#15803d]/60">Estimated Cost</p>
                <p className="font-bold">£{Number(selectedRecipe.estimatedCost || 0).toFixed(2)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="font-bold text-lg mb-3 border-b border-[#dcfce7] pb-2">Ingredients</h3>
                <ul className="space-y-2">
                  {selectedRecipe.ingredients?.map((ing, idx) => (
                    <li key={idx} className="flex justify-between text-sm gap-3">
                      <span>{ing.name}</span>
                      <span className="text-[#15803d]/60 text-right">
                        {[ing.amount, ing.unit].filter(Boolean).join(' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-lg mb-3 border-b border-[#dcfce7] pb-2">Instructions</h3>
                <ol className="space-y-3">
                  {selectedRecipe.instructions?.map((step, idx) => (
                    <li key={idx} className="flex gap-3 text-sm">
                      <span className="font-bold text-[#15803d]">{idx + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl z-30 ${
            toast.type === 'success' ? 'bg-[#15803d] text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}