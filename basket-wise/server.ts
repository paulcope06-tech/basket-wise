import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

// Supabase initialization
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "placeholder";
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Auth Middleware using Supabase
  const authenticate = async (req: any, res: any, next: any) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const token = authHeader.split(" ")[1];
      
      if (!token || token === "undefined" || token === "null" || token.length < 10) {
        return res.status(401).json({ error: "Invalid or missing token" });
      }
      
      if (supabaseUrl.includes('placeholder')) {
        // In placeholder mode, we can't verify tokens, but we also shouldn't crash
        return res.status(401).json({ error: "Backend not configured" });
      }

      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error || !user) {
        if (error) console.error("Supabase Auth error:", error.message, error.status);
        return res.status(401).json({ error: "Invalid token", details: error?.message });
      }

      req.userId = user.id;
      req.userEmail = user.email;
      next();
    } catch (err) {
      console.error("Authentication middleware crash:", err);
      res.status(500).json({ error: "Internal server error during authentication" });
    }
  };

  // Subscription check middleware
  const checkSubscription = async (req: any, res: any, next: any) => {
    try {
      const { data: settings, error } = await supabase
        .from('user_settings')
        .select('subscription_status')
        .eq('user_id', req.userId)
        .single();

      if (error || !settings) {
        // If no settings found, we might want to create them or assume free trial
        return next();
      }

      const status = settings.subscription_status;
      if (status === 'active' || status === 'trialing') {
        next();
      } else {
        res.status(403).json({ 
          error: "Subscription required", 
          message: "Your free trial has ended. Please subscribe to continue using Basket Wise." 
        });
      }
    } catch (err) {
      console.error("Subscription check crash:", err);
      next(); // Fail open for subscription check to avoid blocking users on DB errors
    }
  };

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: "supabase" });
  });

  app.get("/api/auth/me", authenticate, async (req: any, res) => {
    res.json({ id: req.userId, email: req.userEmail });
  });

  // User Settings
  app.get("/api/user/settings", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', req.userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        return res.status(500).json({ error: error.message });
      }

      if (!data) {
        // Return defaults if not found
        return res.json({ budget: 60, adults: 2, children: 2, subscription_status: 'trialing', checked_items: [] });
      }

      res.json({
        ...data,
        checked_items: typeof data.checked_items === 'string' ? JSON.parse(data.checked_items) : (data.checked_items || [])
      });
    } catch (err) {
      console.error("Error fetching settings:", err);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/user/settings", authenticate, async (req: any, res) => {
    try {
      const { budget, adults, children } = req.body;
      const { data, error } = await supabase
        .from('user_settings')
        .upsert({ 
          user_id: req.userId, 
          budget, 
          adults, 
          children,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      res.json(data);
    } catch (err) {
      console.error("Error saving settings:", err);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/user/checked-items", authenticate, async (req: any, res) => {
    const { items } = req.body;
    const { error } = await supabase
      .from('user_settings')
      .upsert({ 
        user_id: req.userId, 
        checked_items: items,
        updated_at: new Date().toISOString()
      });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Profiles
  app.get("/api/profiles", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json((data || []).map((p: any) => ({
        ...p,
        dietaryPreference: p.dietary_preference,
        allergies: typeof p.allergies === 'string' ? JSON.parse(p.allergies) : (p.allergies || []),
        dislikedIngredients: typeof p.disliked_ingredients === 'string' ? JSON.parse(p.disliked_ingredients) : (p.disliked_ingredients || []),
        isActive: p.is_active
      })));
    } catch (err) {
      console.error("Error fetching profiles:", err);
      res.status(500).json({ error: "Failed to fetch profiles" });
    }
  });

  app.post("/api/profiles", authenticate, async (req: any, res) => {
    try {
      const { name, dietaryPreference, allergies, dislikedIngredients, isActive } = req.body;
      const id = uuidv4();
      const profile = {
        id,
        user_id: req.userId,
        name,
        dietary_preference: dietaryPreference,
        allergies,
        disliked_ingredients: dislikedIngredients,
        is_active: isActive
      };
      const { data, error } = await supabase
        .from('profiles')
        .insert(profile)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      res.json({
        ...data,
        dietaryPreference: data.dietary_preference,
        dislikedIngredients: data.disliked_ingredients,
        isActive: data.is_active
      });
    } catch (err) {
      console.error("Error creating profile:", err);
      res.status(500).json({ error: "Failed to create profile" });
    }
  });

  app.put("/api/profiles/:id", authenticate, async (req: any, res) => {
    try {
      const { name, dietaryPreference, allergies, dislikedIngredients, isActive } = req.body;
      const { error } = await supabase
        .from('profiles')
        .update({
          name,
          dietary_preference: dietaryPreference,
          allergies,
          disliked_ingredients: dislikedIngredients,
          is_active: isActive
        })
        .eq('id', req.params.id)
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error updating profile:", err);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.delete("/api/profiles/:id", authenticate, async (req: any, res) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting profile:", err);
      res.status(500).json({ error: "Failed to delete profile" });
    }
  });

  // Meal Plans
  app.get("/api/meal-plan", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('meal_plans')
        .select('*')
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json((data || []).map((p: any) => ({
        ...p,
        recipe: typeof p.recipe === 'string' ? JSON.parse(p.recipe) : p.recipe,
        mealType: p.meal_type
      })));
    } catch (err) {
      console.error("Error fetching meal plan:", err);
      res.status(500).json({ error: "Failed to fetch meal plan" });
    }
  });

  app.post("/api/meal-plan", authenticate, checkSubscription, async (req: any, res) => {
    try {
      const { items } = req.body;
      
      // Delete existing
      await supabase.from('meal_plans').delete().eq('user_id', req.userId);

      // Insert new
      const mealPlanItems = items.map((i: any) => ({
        id: uuidv4(),
        user_id: req.userId,
        day: i.day,
        meal_type: i.mealType,
        recipe: i.recipe
      }));

      const { error } = await supabase.from('meal_plans').insert(mealPlanItems);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error saving meal plan:", err);
      res.status(500).json({ error: "Failed to save meal plan" });
    }
  });

  // Favorites
  app.get("/api/favorites", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('favorites')
        .select('*')
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json((data || []).map((f: any) => ({
        ...f,
        recipeId: f.recipe_id,
        recipe: typeof f.recipe === 'string' ? JSON.parse(f.recipe) : f.recipe
      })));
    } catch (err) {
      console.error("Error fetching favorites:", err);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });

  app.post("/api/favorites", authenticate, async (req: any, res) => {
    try {
      const { recipeId, recipe } = req.body;
      const id = uuidv4();
      const { data, error } = await supabase
        .from('favorites')
        .insert({
          id,
          user_id: req.userId,
          recipe_id: recipeId,
          recipe
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      res.json({
        ...data,
        recipeId: data.recipe_id,
        recipe: typeof data.recipe === 'string' ? JSON.parse(data.recipe) : data.recipe
      });
    } catch (err) {
      console.error("Error saving favorite:", err);
      res.status(500).json({ error: "Failed to save favorite" });
    }
  });

  app.delete("/api/favorites/:id", authenticate, async (req: any, res) => {
    try {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting favorite:", err);
      res.status(500).json({ error: "Failed to delete favorite" });
    }
  });

  // Shopping Items
  app.get("/api/shopping-items", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('shopping_items')
        .select('*')
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json(data || []);
    } catch (err) {
      console.error("Error fetching shopping items:", err);
      res.status(500).json({ error: "Failed to fetch shopping items" });
    }
  });

  app.post("/api/shopping-items", authenticate, async (req: any, res) => {
    try {
      const { name, amount, unit, category } = req.body;
      const id = uuidv4();
      const { data, error } = await supabase
        .from('shopping_items')
        .insert({
          id,
          user_id: req.userId,
          name,
          amount,
          unit,
          category
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      res.json(data);
    } catch (err) {
      console.error("Error saving shopping item:", err);
      res.status(500).json({ error: "Failed to save shopping item" });
    }
  });

  app.delete("/api/shopping-items/:id", authenticate, async (req: any, res) => {
    try {
      const { error } = await supabase
        .from('shopping_items')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting shopping item:", err);
      res.status(500).json({ error: "Failed to delete shopping item" });
    }
  });

  // Reviews
  app.get("/api/reviews/:recipeId", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('recipe_id', req.params.recipeId)
        .order('date', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      res.json(data || []);
    } catch (err) {
      console.error("Error fetching reviews:", err);
      res.status(500).json({ error: "Failed to fetch reviews" });
    }
  });

  app.post("/api/reviews", authenticate, async (req: any, res) => {
    try {
      const { recipeId, rating, comment } = req.body;
      const id = uuidv4();
      const date = new Date().toISOString();
      const { data, error } = await supabase
        .from('reviews')
        .insert({
          id,
          user_id: req.userId,
          recipe_id: recipeId,
          rating,
          comment,
          date
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      res.json(data);
    } catch (err) {
      console.error("Error saving review:", err);
      res.status(500).json({ error: "Failed to save review" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("✅ Supabase integration active.");
  });
}

startServer();
