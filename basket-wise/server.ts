import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://placeholder.supabase.co";

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "placeholder";

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type MealType = "breakfast" | "lunch" | "dinner";

function shuffleArray<T>(items: T[]) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickUniqueRecipes(recipes: any[], count: number) {
  if (recipes.length < count) {
    throw new Error(`Not enough recipes. Needed ${count}, found ${recipes.length}.`);
  }
  return shuffleArray(recipes).slice(0, count);
}

function normalizeRecipe(recipe: any) {
  if (!recipe) return null;

  return {
    id: recipe.id,
    title: recipe.title || "Untitled Recipe",
    description: recipe.description || "",
    prepTime: Number(recipe.prep_time ?? 10),
    cookTime: Number(recipe.cook_time ?? 20),
    costPerServing: Number(recipe.estimated_cost ?? 0),
    estimatedCost: Number(recipe.estimated_cost ?? 0),
    servings: Number(recipe.servings ?? 4),
    ingredients: Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((ing: any) => {
          if (typeof ing === "string") {
            return {
              name: ing,
              amount: "",
              unit: "",
              category: "Cupboard",
            };
          }
          return {
            name: ing?.name || "Ingredient",
            amount: String(ing?.amount ?? ""),
            unit: ing?.unit || "",
            category: ing?.category || "Cupboard",
          };
        })
      : [],
    instructions: Array.isArray(recipe.instructions)
      ? recipe.instructions
      : typeof recipe.instructions === "string"
      ? recipe.instructions
          .split(/\d+\.\s+/)
          .map((s: string) => s.trim())
          .filter(Boolean)
      : ["No instructions available"],
    imageUrl: recipe.image_url || "",
    calories: Number(recipe.calories ?? 0),
    tags:
      recipe.plan_date?.tags ||
      recipe.plan_data?.tags ||
      recipe.plan?.tags ||
      [],
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

      if (supabaseUrl.includes("placeholder")) {
        return res.status(401).json({ error: "Backend not configured" });
      }

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({
          error: "Invalid token",
          details: error?.message,
        });
      }

      req.userId = user.id;
      req.userEmail = user.email;
      next();
    } catch (err) {
      console.error("Authentication middleware crash:", err);
      res.status(500).json({ error: "Internal server error during authentication" });
    }
  };

  const checkSubscription = async (req: any, res: any, next: any) => {
    try {
      const { data: settings, error } = await supabase
        .from("user_settings")
        .select("subscription_status")
        .eq("user_id", req.userId)
        .single();

      if (error || !settings) {
        return next();
      }

      const status = settings.subscription_status;
      if (status === "active" || status === "trialing") {
        next();
      } else {
        res.status(403).json({
          error: "Subscription required",
          message:
            "Your free trial has ended. Please subscribe to continue using Basket Wise.",
        });
      }
    } catch (err) {
      console.error("Subscription check crash:", err);
      next();
    }
  };

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: "supabase" });
  });

  app.get("/api/auth/me", authenticate, async (req: any, res) => {
    res.json({ id: req.userId, email: req.userEmail });
  });

  app.get("/api/user/settings", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", req.userId)
        .single();

      if (error && error.code !== "PGRST116") {
        return res.status(500).json({ error: error.message });
      }

      if (!data) {
        return res.json({
          budget: 60,
          adults: 2,
          children: 2,
          subscription_status: "trialing",
          checked_items: [],
        });
      }

      res.json({
        ...data,
        checked_items:
          typeof data.checked_items === "string"
            ? JSON.parse(data.checked_items)
            : data.checked_items || [],
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
        .from("user_settings")
        .upsert({
          user_id: req.userId,
          budget,
          adults,
          children,
          updated_at: new Date().toISOString(),
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
    try {
      const { items } = req.body;

      const { error } = await supabase.from("user_settings").upsert({
        user_id: req.userId,
        checked_items: items,
        updated_at: new Date().toISOString(),
      });

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error saving checked items:", err);
      res.status(500).json({ error: "Failed to save checked items" });
    }
  });

  app.get("/api/profiles", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", req.userId);

      if (error) return res.status(500).json({ error: error.message });

      res.json(
        (data || []).map((p: any) => ({
          ...p,
          dietaryPreference: p.dietary_preference,
          allergies:
            typeof p.allergies === "string" ? JSON.parse(p.allergies) : p.allergies || [],
          dislikedIngredients:
            typeof p.disliked_ingredients === "string"
              ? JSON.parse(p.disliked_ingredients)
              : p.disliked_ingredients || [],
          isActive: p.is_active,
        }))
      );
    } catch (err) {
      console.error("Error fetching profiles:", err);
      res.status(500).json({ error: "Failed to fetch profiles" });
    }
  });

  app.post("/api/profiles", authenticate, async (req: any, res) => {
    try {
      const { name, dietaryPreference, allergies, dislikedIngredients, isActive } = req.body;

      const profile = {
        id: uuidv4(),
        user_id: req.userId,
        name,
        dietary_preference: dietaryPreference,
        allergies,
        disliked_ingredients: dislikedIngredients,
        is_active: isActive,
      };

      const { data, error } = await supabase
        .from("profiles")
        .insert(profile)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      res.json({
        ...data,
        dietaryPreference: data.dietary_preference,
        dislikedIngredients: data.disliked_ingredients,
        isActive: data.is_active,
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
        .from("profiles")
        .update({
          name,
          dietary_preference: dietaryPreference,
          allergies,
          disliked_ingredients: dislikedIngredients,
          is_active: isActive,
        })
        .eq("id", req.params.id)
        .eq("user_id", req.userId);

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
        .from("profiles")
        .delete()
        .eq("id", req.params.id)
        .eq("user_id", req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting profile:", err);
      res.status(500).json({ error: "Failed to delete profile" });
    }
  });

  app.get("/api/recipes", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) return res.status(500).json({ error: error.message });

      res.json((data || []).map((recipe: any) => normalizeRecipe(recipe)));
    } catch (err) {
      console.error("Error fetching recipes:", err);
      res.status(500).json({ error: "Failed to fetch recipes" });
    }
  });

  app.get("/api/meal-plan", authenticate, async (req: any, res) => {
    try {
      const { data: latestPlan, error: latestPlanError } = await supabase
        .from("meal_plan")
        .select("id, user_id, created_at, name, start_date, end_date")
        .eq("user_id", req.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestPlanError) {
        return res.status(500).json({ error: latestPlanError.message });
      }

      if (!latestPlan) {
        return res.json([]);
      }

      const { data: items, error: itemsError } = await supabase
        .from("meal_plan_items")
        .select("id, plan_id, day, meal_type, recipe_id, created_at")
        .eq("plan_id", latestPlan.id)
        .order("day", { ascending: true });

      if (itemsError) {
        return res.status(500).json({ error: itemsError.message });
      }

      const recipeIds = Array.from(
        new Set((items || []).map((item: any) => item.recipe_id).filter(Boolean))
      );

      let recipesById = new Map<string, any>();

      if (recipeIds.length > 0) {
        const { data: recipes, error: recipesError } = await supabase
          .from("recipes")
          .select("*")
          .in("id", recipeIds);

        if (recipesError) {
          return res.status(500).json({ error: recipesError.message });
        }

        recipesById = new Map((recipes || []).map((recipe: any) => [recipe.id, recipe]));
      }

      const result = (items || []).map((item: any) => ({
        id: item.id,
        planId: item.plan_id,
        day: Number(item.day),
        mealType: item.meal_type,
        recipeId: item.recipe_id,
        recipe: item.recipe_id ? normalizeRecipe(recipesById.get(item.recipe_id)) : null,
      }));

      res.json(result);
    } catch (err) {
      console.error("Error fetching meal plan:", err);
      res.status(500).json({ error: "Failed to fetch meal plan" });
    }
  });

  app.post("/api/meal-plan", authenticate, checkSubscription, async (req: any, res) => {
    try {
      const { items, name, startDate, endDate } = req.body;

      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "items must be an array" });
      }

      const planId = uuidv4();
      const now = new Date().toISOString();

      const { error: planError } = await supabase.from("meal_plan").insert({
        id: planId,
        user_id: req.userId,
        name: name || "Weekly Meal Plan",
        start_date: startDate || null,
        end_date: endDate || null,
        created_at: now,
      });

      if (planError) {
        return res.status(500).json({ error: planError.message });
      }

      const mealPlanItems = items.map((i: any) => ({
        id: uuidv4(),
        plan_id: planId,
        day: i.day,
        meal_type: i.mealType,
        recipe_id: i.recipeId,
        created_at: now,
      }));

      const { error: itemsError } = await supabase
        .from("meal_plan_items")
        .insert(mealPlanItems);

      if (itemsError) return res.status(500).json({ error: itemsError.message });

      res.json({ success: true, planId });
    } catch (err) {
      console.error("Error saving meal plan:", err);
      res.status(500).json({ error: "Failed to save meal plan" });
    }
  });

  app.post(
    "/api/generate-meal-plan",
    authenticate,
    checkSubscription,
    async (req: any, res) => {
      try {
        console.log("generate route hit");

        const { preferences = {} } = req.body;
        console.log("preferences", preferences);

        const { data: recipes, error } = await supabase.from("recipes").select("*");

        console.log("recipes fetched", recipes?.length, error);

        if (error) {
          return res.status(500).json({ error: error.message });
        }

        if (!recipes || recipes.length === 0) {
          return res.status(400).json({ error: "No recipes found in library" });
        }

        const breakfasts = recipes.filter(
          (r: any) => String(r.meal_type).toLowerCase() === "breakfast"
        );
        const lunches = recipes.filter(
          (r: any) => String(r.meal_type).toLowerCase() === "lunch"
        );
        const dinners = recipes.filter(
          (r: any) => String(r.meal_type).toLowerCase() === "dinner"
        );

        console.log("grouped", {
          breakfasts: breakfasts.length,
          lunches: lunches.length,
          dinners: dinners.length,
        });

        if (breakfasts.length < 7 || lunches.length < 7 || dinners.length < 7) {
          return res.status(400).json({
            error: "You need at least 7 breakfast, 7 lunch, and 7 dinner recipes.",
          });
        }

        const selectedBreakfasts = pickUniqueRecipes(breakfasts, 7);
        const selectedLunches = pickUniqueRecipes(lunches, 7);
        const selectedDinners = pickUniqueRecipes(dinners, 7);

        const planId = uuidv4();
        const now = new Date().toISOString();

        const { error: planError } = await supabase.from("meal_plan").insert({
          id: planId,
          user_id: req.userId,
          name: "Weekly Meal Plan",
          created_at: now,
        });

        if (planError) {
          return res.status(500).json({ error: planError.message });
        }

        const items = [];

        for (let day = 0; day < 7; day++) {
          items.push({
            id: uuidv4(),
            plan_id: planId,
            day,
            meal_type: "breakfast",
            recipe_id: selectedBreakfasts[day].id,
            created_at: now,
          });

          items.push({
            id: uuidv4(),
            plan_id: planId,
            day,
            meal_type: "lunch",
            recipe_id: selectedLunches[day].id,
            created_at: now,
          });

          items.push({
            id: uuidv4(),
            plan_id: planId,
            day,
            meal_type: "dinner",
            recipe_id: selectedDinners[day].id,
            created_at: now,
          });
        }

        const { error: itemsError } = await supabase
          .from("meal_plan_items")
          .insert(items);

        if (itemsError) {
          return res.status(500).json({ error: itemsError.message });
        }

        const result = items.map((item: any) => {
          let recipe: any = null;

          if (item.meal_type === "breakfast") recipe = selectedBreakfasts[item.day];
          else if (item.meal_type === "lunch") recipe = selectedLunches[item.day];
          else recipe = selectedDinners[item.day];

          return {
            day: item.day,
            mealType: item.meal_type,
            recipeId: item.recipe_id,
            recipe: normalizeRecipe(recipe),
          };
        });

        res.json({
          success: true,
          planId,
          items: result,
        });
      } catch (err: any) {
        console.error("Error generating meal plan:", err);
        res.status(500).json({
          error: err?.message || "Failed to generate meal plan",
        });
      }
    }
  );

  app.get("/api/favorites", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from("favorites")
        .select("*")
        .eq("user_id", req.userId);

      if (error) return res.status(500).json({ error: error.message });

      res.json(
        (data || []).map((f: any) => ({
          ...f,
          recipeId: f.recipe_id,
          recipe: typeof f.recipe === "string" ? JSON.parse(f.recipe) : f.recipe,
        }))
      );
    } catch (err) {
      console.error("Error fetching favorites:", err);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });

  app.post("/api/favorites", authenticate, async (req: any, res) => {
    try {
      const { recipeId, recipe } = req.body;

      const { data, error } = await supabase
        .from("favorites")
        .insert({
          id: uuidv4(),
          user_id: req.userId,
          recipe_id: recipeId,
          recipe,
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      res.json({
        ...data,
        recipeId: data.recipe_id,
        recipe: typeof data.recipe === "string" ? JSON.parse(data.recipe) : data.recipe,
      });
    } catch (err) {
      console.error("Error saving favorite:", err);
      res.status(500).json({ error: "Failed to save favorite" });
    }
  });

  app.delete("/api/favorites/:id", authenticate, async (req: any, res) => {
    try {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("id", req.params.id)
        .eq("user_id", req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting favorite:", err);
      res.status(500).json({ error: "Failed to delete favorite" });
    }
  });

  app.get("/api/shopping-items", authenticate, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from("shopping_items")
        .select("*")
        .eq("user_id", req.userId);

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

      const { data, error } = await supabase
        .from("shopping_items")
        .insert({
          id: uuidv4(),
          user_id: req.userId,
          name,
          amount,
          unit,
          category,
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
        .from("shopping_items")
        .delete()
        .eq("id", req.params.id)
        .eq("user_id", req.userId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting shopping item:", err);
      res.status(500).json({ error: "Failed to delete shopping item" });
    }
  });

  app.get("/api/reviews/:recipeId", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("recipe_id", req.params.recipeId)
        .order("date", { ascending: false });

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

      const { data, error } = await supabase
        .from("reviews")
        .insert({
          id: uuidv4(),
          user_id: req.userId,
          recipe_id: recipeId,
          rating,
          comment,
          date: new Date().toISOString(),
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

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("✅ Supabase integration active.");
  });
}

startServer();