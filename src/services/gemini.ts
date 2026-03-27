import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { Recipe, MealType, UserProfile } from "../types";
import { apiFetch } from "../lib/api";

const getAI = () => {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
};

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || "";
      const isQuotaError = errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED');
      const isPermissionError = 
        errorMessage.toLowerCase().includes('permission denied') || 
        errorMessage.includes('403') ||
        errorMessage.includes('401') ||
        errorMessage.toLowerCase().includes('api key') ||
        errorMessage.toLowerCase().includes('unauthorized');
      
      if (isQuotaError && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`Quota exceeded, retrying in ${delay.toFixed(0)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (isPermissionError) {
        console.error("Gemini API Permission Denied. This usually means an API key needs to be selected or the current key lacks permissions.");
        // We throw a specific error that the UI can catch to show the key selection dialog
        throw new Error("GEMINI_PERMISSION_DENIED");
      }

      throw error;
    }
  }
  throw lastError;
}

const RECIPE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    ingredients: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          amount: { type: Type.STRING },
          unit: { type: Type.STRING },
          category: { type: Type.STRING },
          estimatedPrice: { type: Type.NUMBER }
        },
        required: ["name", "amount", "unit", "category"]
      }
    },
    instructions: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    prepTime: { type: Type.NUMBER },
    cookTime: { type: Type.NUMBER },
    costPerServing: { type: Type.NUMBER },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    nutrition: {
      type: Type.OBJECT,
      description: "Estimated nutritional information per serving",
      properties: {
        calories: { type: Type.NUMBER, description: "Calories per serving" },
        protein: { type: Type.NUMBER, description: "Grams of protein per serving" },
        carbohydrates: { type: Type.NUMBER, description: "Grams of carbohydrates per serving" },
        fat: { type: Type.NUMBER, description: "Grams of fat per serving" }
      },
      required: ["calories", "protein", "carbohydrates", "fat"]
    }
  },
  required: ["title", "ingredients", "instructions", "prepTime", "cookTime", "costPerServing", "nutrition"]
};

export async function generateWeeklyPlan(
  filters: string[],
  budget: number,
  adults: number,
  children: number,
  favorites: Recipe[] = [],
  profiles: UserProfile[] = []
): Promise<{ day: number; mealType: MealType; recipe: Recipe }[]> {
  const ai = getAI();
  const activeProfiles = profiles.filter(p => p.isActive);
  const profileInstructions = activeProfiles.map(p => {
    return `- ${p.name}: Dietary Preference: ${p.dietaryPreference}, Allergies: ${p.allergies.join(", ") || "None"}, Dislikes: ${p.dislikedIngredients.join(", ") || "None"}`;
  }).join("\n");

  const dailyBudget = budget / 7;
  const householdSize = adults + children;
  const targetCostPerServing = dailyBudget / householdSize / 3;

  // Step 1: Generate a list of 21 unique meal titles first to ensure variety
  const titlesPrompt = `Generate a list of 21 unique and varied meal titles (7 days, 3 meals each: Breakfast, Lunch, Dinner) for a household of ${adults} adults and ${children} children.
    Filters: ${filters.join(", ")}.
    Target Weekly Budget: £${budget} total.
    This means the total cost of all 21 meals for the entire household (${householdSize} people) must not exceed £${budget}.
    Dietary Context: ${profileInstructions || "None"}.
    Include these favorites if possible: ${favorites.map(f => f.title).join(", ")}.
    Ensure NO DUPLICATES. Every meal must be different.
    Return as JSON array of objects with { day: number, mealType: string, title: string }.`;

  const titlesResponse = await withRetry(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: titlesPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            day: { type: Type.INTEGER },
            mealType: { type: Type.STRING, enum: ["breakfast", "lunch", "dinner"] },
            title: { type: Type.STRING }
          },
          required: ["day", "mealType", "title"]
        }
      }
    }
  }));

  const mealTitles = JSON.parse(titlesResponse.text);

  // Step 2: Generate the full recipes in parallel based on the unique titles
  const dayPromises = [0, 1, 2, 3, 4, 5, 6].map(async (day) => {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayName = dayNames[day];
    const dayTitles = mealTitles.filter((m: any) => m.day === day);
    
    const prompt = `Generate the full recipe details for these 3 specific meals for ${dayName}:
      ${dayTitles.map((t: any) => `- ${t.mealType.toUpperCase()}: ${t.title}`).join("\n")}
      
      Household: ${adults} adults, ${children} children (Total: ${householdSize} people).
      Daily Budget for the whole household: £${dailyBudget.toFixed(2)}.
      Target average cost per serving: £${targetCostPerServing.toFixed(2)}.
      
      CRITICAL: The sum of (costPerServing * ${householdSize}) for these 3 meals MUST be approximately £${dailyBudget.toFixed(2)}.
      Be realistic with ingredient prices.
      Dietary Context: ${profileInstructions || "None"}.
      
      Return exactly 3 meals with full RECIPE_SCHEMA details.`;

    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              mealType: { type: Type.STRING, enum: ["breakfast", "lunch", "dinner"] },
              recipe: RECIPE_SCHEMA
            },
            required: ["mealType", "recipe"]
          }
        }
      }
    }));

    try {
      const dayMeals = JSON.parse(response.text);
      return (Array.isArray(dayMeals) ? dayMeals : []).map((m: any) => ({
        ...m,
        day
      }));
    } catch (e) {
      console.error(`Error parsing day ${day}:`, e);
      return [];
    }
  });

  const results = await Promise.all(dayPromises);
  return results.flat();
}

export async function regenerateSingleMeal(
  day: number,
  mealType: MealType,
  filters: string[],
  budget: number,
  adults: number,
  children: number,
  profiles: UserProfile[] = []
): Promise<Recipe> {
  const ai = getAI();
  const activeProfiles = profiles.filter(p => p.isActive);
  const profileInstructions = activeProfiles.map(p => {
    return `- ${p.name}: Dietary Preference: ${p.dietaryPreference}, Allergies: ${p.allergies.join(", ") || "None"}, Dislikes: ${p.dislikedIngredients.join(", ") || "None"}`;
  }).join("\n");

  const prompt = `Generate a single ${mealType} recipe for day ${day} for a household of ${adults} adults and ${children} children.
    Filters: ${filters.join(", ")}.
    Weekly Budget Context: £${budget}.
    
    HOUSEHOLD PROFILES & PREFERENCES:
    ${profileInstructions || "No specific profiles provided."}
    
    Provide estimated nutritional information (calories, protein, carbs, fat) per serving.
    Ensure portion sizes are appropriate for ${adults} adults and ${children} children.
    STRICTLY ADHERE to all dietary preferences, allergies, and dislikes listed in the HOUSEHOLD PROFILES.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RECIPE_SCHEMA
    }
  }));

  const recipe = JSON.parse(response.text);
  return recipe;
}

export async function comparePrices(shoppingList: any[], budget?: number): Promise<any> {
  const ai = getAI();
  const listStr = shoppingList.map(i => `${i.amount} ${i.unit} ${i.name}`).join(", ");
  
  const prompt = `Using real-time data from trolley.co.uk and major UK supermarkets, compare the total cost of this shopping list across: Aldi, Lidl, Tesco, Asda, Sainsbury's, Morrisons.
    List: ${listStr}.
    
    STRICT TARGET WEEKLY BUDGET: £${budget || 'Not specified'}.
    
    CRITICAL INSTRUCTIONS:
    1. Calculate the total cost for each supermarket as accurately as possible for the ENTIRE list. 
    2. If the total for a supermarket exceeds the target budget of £${budget}, you MUST highlight this and prioritize identifying cheaper alternatives or store-brand swaps to bring the total closer to or under £${budget}.
    3. Be honest about prices. If it's impossible to meet the budget with this list, state the realistic totals and provide the best possible "Smart Swaps".
    
    Provide:
    1. Total estimated cost for each supermarket.
    2. Identify the cheapest supermarket.
    3. Suggest 3 smart swaps to save money.
    
    Return as JSON.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          comparisons: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                totalCost: { type: Type.NUMBER }
              }
            }
          },
          cheapest: { type: Type.STRING },
          swaps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                original: { type: Type.STRING },
                alternative: { type: Type.STRING },
                savings: { type: Type.NUMBER }
              }
            }
          }
        }
      }
    }
  }));

  return JSON.parse(response.text);
}
