export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface Ingredient {
  name: string;
  amount: string;
  unit: string;
  category: string;
  estimatedPrice?: number;
}

export interface NutritionalInfo {
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
}

export interface Recipe {
  id: string;
  title: string;
  ingredients: Ingredient[];
  instructions: string[];
  prepTime: number;
  cookTime: number;
  costPerServing: number;
  imageUrl?: string;
  tags: string[];
  nutrition: NutritionalInfo;
}

export interface Review {
  id: string;
  recipeId: string;
  rating: number;
  comment: string;
  date: string;
}

export interface MealPlanItem {
  day: number; // 0-6
  mealType: MealType;
  recipe: Recipe;
}

export interface Favorite {
  id?: string;
  recipeId: string;
  recipe: Recipe;
}

export interface SupermarketComparison {
  name: string;
  totalCost: number;
  logo?: string;
  cheapestItems: string[];
}

export interface UserProfile {
  id?: string;
  name: string;
  dietaryPreference: 'none' | 'vegetarian' | 'vegan' | 'pescatarian' | 'keto' | 'paleo';
  allergies: string[];
  dislikedIngredients: string[];
  isActive: boolean;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
