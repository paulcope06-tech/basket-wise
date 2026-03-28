import React, { useEffect, useState } from 'react';
import { RefreshCw, ShoppingBasket, LogOut, Clock, Coins } from 'lucide-react';
import { supabase } from './lib/supabase';

type MealType = 'breakfast' | 'lunch' | 'dinner';

type DbRecipe = {
  title?: string;
  name?: string;
  recipeName?: string;
  description?: string;
  ingredients?: any[];
  instructions?: string[] | string;
  method?: string[];
  prepTime?: number;
  cookTime?: number;
  prep_time?: number;
  cook_time?: number;
  servings?: number;
  estimated_cost?: number;
  imageUrl?: string;
  image_url?: string;
};

type AppRecipe = {
  title: string;
  description: string;
  prepTime: number;
  cookTime: number;
  costPerServing: number;
  ingredients: { name: string; amount: string; unit: string; category: string }[];
  instructions: string[];
  servings: number;
  imageUrl: string;
};

type MealPlanItem = {
  day: number;
  mealType: MealType;
  recipe: AppRecipe;
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

function toAppRecipe(dbRecipe: DbRecipe): AppRecipe {
  const instructions =
    Array.isArray(dbRecipe.instructions)
      ? dbRecipe.instructions
      : Array.isArray(dbRecipe.method)
      ? dbRecipe.method
      : typeof dbRecipe.instructions === 'string'
      ? dbRecipe.instructions
          .split(/\d+\.\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : ['No instructions available'];

  const ingredients = Array.isArray(dbRecipe.ingredients)
    ? dbRecipe.ingredients.map((ing: any) => ({
        name: ing?.name || 'Ingredient',
        amount: String(ing?.amount ?? '1'),
        unit: ing?.unit || '',
        category: ing?.category || 'Cupboard',
      }))
    : [{ name: 'Ingredients not provided', amount: '1', unit: '', category: 'Cupboard' }];

  return {
    title: dbRecipe.title || dbRecipe.name || dbRecipe.recipeName || 'Generated Recipe',
    description: dbRecipe.description || '',
    prepTime: Number(dbRecipe.prepTime ?? dbRecipe.prep_time ?? 10),
    cookTime: Number(dbRecipe.cookTime ?? dbRecipe.cook_time ?? 20),
    costPerServing: Number(dbRecipe.estimated_cost ?? 2.5),
    ingredients,
    instructions,
    servings: Number(dbRecipe.servings ?? 4),
    imageUrl: dbRecipe.imageUrl || dbRecipe.image_url || '',
  };
}

function buildMealPlanFromRecipes(recipes: DbRecipe[]): MealPlanItem[] {
  const slots: MealPlanItem[] = [];
  let index = 0;

  for (let day = 0; day < DAYS.length; day++) {
    for (const mealType of MEAL_TYPES) {
      const recipe = recipes[index];
      if (recipe) {
        slots.push({
          day,
          mealType,
          recipe: toAppRecipe(recipe),
        });
      }
      index++;
    }
  }

  return slots;
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [budget, setBudget] = useState(60);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(2);

  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
    setToast({ message: 'Logged out.', type: 'success' });
  };

  const generateSingleRecipe = async (prompt: string): Promise<DbRecipe> => {
    const { data, error } = await supabase.functions.invoke('generate-recipe', {
      body: { prompt },
    });

    console.log('FUNCTION DATA:', data);
    console.log('FUNCTION ERROR:', error);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Recipe generation failed');
    }
    if (!data?.recipe) {
      throw new Error('No recipe returned');
    }

    return data.recipe as DbRecipe;
  };

  const handleGeneratePlan = async () => {
    if (!user) return;

    setLoading(true);

    try {
      const generatedResults: DbRecipe[] = [];

      for (let day = 0; day < DAYS.length; day++) {
        for (const mealType of MEAL_TYPES) {
          const prompt = `Create one ${mealType} recipe for ${DAYS[day]} for a family of ${adults} adults and ${children} children, with a total weekly budget of £${budget}. Return valid JSON only with these fields: title, description, ingredients, instructions, prepTime, cookTime, servings.`;

          const recipe = await generateSingleRecipe(prompt);
          generatedResults.push(recipe);
        }
      }

      console.log('GENERATED RESULTS:', generatedResults);
      setMealPlan(buildMealPlanFromRecipes(generatedResults));
      setToast({ message: 'Weekly plan generated successfully.', type: 'success' });
    } catch (err: any) {
      console.error('Failed to generate plan', err);
      setToast({ message: err?.message || 'Failed to generate plan.', type: 'error' });
    } finally {
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
            <p className="text-sm text-[#15803d]/70 mt-2">This can take a minute.</p>
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
                      className={`p-3 rounded-2xl border h-36 flex flex-col justify-between ${
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
                          {meal?.recipe.title || 'No meal'}
                        </p>
                      </div>

                      {meal && (
                        <div className="flex items-center gap-2 text-[11px] text-[#15803d]/70 mt-3">
                          <Clock size={12} />
                          <span>{meal.recipe.prepTime + meal.recipe.cookTime}m</span>
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