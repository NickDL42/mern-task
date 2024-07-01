//@ts-nocheck
"use server";

import { sql } from "kysely";
import { DEFAULT_PAGE_SIZE } from "../../constant";
import { db } from "../../db";
import { InsertProducts, UpdateProducts } from "@/types";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/utils/authOptions";
import { cache } from "react";

export async function addProduct(productData: InsertProducts, categoryIds: number[]) {
  try {
    await db.transaction().execute(async (trx) => {
      // Insert the product and get the inserted ID
      const insertedProduct = await trx
        .insertInto("products")
        .values({
          name: productData.name,
          description: productData.description,
          old_price: productData.old_price,
          discount: productData.discount,
          price: productData.price,
          rating: productData.rating,
          colors: productData.colors,
          brands: JSON.stringify(productData.brands.map(brands => brands.value)),
          gender: productData.gender,
          occasion: productData.occasion.map(occasion => occasion.value).join(', '),
          image_url: productData.image_url,
        })
        .executeTakeFirst();

      const productId = insertedProduct.insertId;

      // Insert into product_categories table
      if (categoryIds.length > 0) {
        const categoryEntries = categoryIds.map((categoryId) => ({
          product_id: productId,
          category_id: categoryId,
        }));
        await trx
          .insertInto("product_categories")
          .values(categoryEntries)
          .execute();
      }
    });

    return { message: "Product added successfully" };
  } catch (error) {
    console.log('error', error);
    return { error: "Something went wrong, cannot add product" };
  }
}


export async function updateProduct(productId: number, productData: UpdateProducts) {
  try {
    console.log('productData', productData);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("products")
        .set({
          name: productData.name,
          description: productData.description,
          old_price: productData.old_price,
          discount: productData.discount,
          price: productData.price,
          rating: productData.rating,
          colors: productData.colors,
          brands: productData.brands,
          gender: productData.gender,
          occasion: productData.occasion,
          image_url: productData.image_url,
        })
        .where("id", "=", productId)
        .execute();

      // Update categories
      await trx.deleteFrom("product_categories").where("product_id", "=", productId).execute();
      
      if (productData.categoryIds.length > 0) {
        const categoryEntries = productData.categoryIds.map((categoryId) => ({
          product_id: productId,
          category_id: categoryId,
        }));
        await trx.insertInto("product_categories").values(categoryEntries).execute();
      }
    });

    return { message: "Product updated successfully" };
  } catch (error) {
    console.error('error', error);
    return { error: "Something went wrong, cannot update product" };
  }
}




export async function getProducts(pageNo = 1, pageSize = DEFAULT_PAGE_SIZE, filters = {}, sortBy = "") {
  try {
    let dbQuery = db.selectFrom("products").selectAll();
    let countQuery = db.selectFrom("products").select(sql`COUNT(DISTINCT products.id) as count`);

    if (filters.brandId) {
      const brandIds = filters.brandId.split(',');
      const conditions = brandIds.map(brandId => `FIND_IN_SET(${brandId}, products.brands) > 0`).join(' OR ');
      dbQuery = dbQuery.where(sql`${sql.raw(conditions)}`);
      countQuery = countQuery.where(sql`${sql.raw(conditions)}`);
    }
    if (filters.priceRangeTo) {
      dbQuery = dbQuery.where('products.price', '<=', Number(filters.priceRangeTo));
      countQuery = countQuery.where('products.price', '<=', Number(filters.priceRangeTo));
    }
    if (filters.gender) {
      dbQuery = dbQuery.where(sql`FIND_IN_SET(${filters.gender}, products.gender) > 0`);
      countQuery = countQuery.where(sql`FIND_IN_SET(${filters.gender}, products.gender) > 0`);
    }
    if (filters.occasions) {
      const occasions = filters.occasions.split(',');
      const conditions = occasions.map(occasion => `FIND_IN_SET('${occasion.trim()}', products.occasion) > 0`).join(' OR ');
      dbQuery = dbQuery.where(sql`${sql.raw(conditions)}`);
      countQuery = countQuery.where(sql`${sql.raw(conditions)}`);
    }
    if (filters.discount) {
      const [minDiscount, maxDiscount] = filters.discount.split('-').map(Number);
      dbQuery = dbQuery.where('products.discount', '>=', minDiscount).where('products.discount', '<=', maxDiscount);
      countQuery = countQuery.where('products.discount', '>=', minDiscount).where('products.discount', '<=', maxDiscount);
    }

    // Apply category filter
    if (filters.categoryId) {
      const categoryIds = filters.categoryId.split(',').map(Number);
      dbQuery = dbQuery.innerJoin(
        "product_categories",
        "products.id",
        "product_categories.product_id"
      ).where("product_categories.category_id", "in", categoryIds);
      countQuery = countQuery.innerJoin(
        "product_categories",
        "products.id",
        "product_categories.product_id"
      ).where("product_categories.category_id", "in", categoryIds);
    }

    // Apply sorting
    if (sortBy) {
      const [field, direction] = sortBy.split('-');
      dbQuery = dbQuery.orderBy(field, direction);
    }

    // Count total number of products after filtering
    const countResult = await countQuery.executeTakeFirst();
    const count = countResult?.count || 0;

    const lastPage = Math.ceil(count / pageSize);
    const offset = (pageNo - 1) * pageSize;

    const products = await dbQuery
      .offset(offset)
      .limit(pageSize)
      .execute();

    const numOfResultsOnCurPage = products.length;

    return { products, count, lastPage, numOfResultsOnCurPage };
  } catch (error) {
    throw error;
  }
}



export const getProduct = cache(async function getProduct(productId: number) {
  // console.log("run");
  try {
    const product = await db
      .selectFrom("products")
      .selectAll()
      .where("id", "=", productId)
      .execute();

    return product;
  } catch (error) {
    return { error: "Could not find the product" };
  }
});

async function enableForeignKeyChecks() {
  await sql`SET foreign_key_checks = 1`.execute(db);
}

async function disableForeignKeyChecks() {
  await sql`SET foreign_key_checks = 0`.execute(db);
}

export async function deleteProduct(productId: number) {
  try {
    await disableForeignKeyChecks();
    await db
      .deleteFrom("product_categories")
      .where("product_categories.product_id", "=", productId)
      .execute();
    await db
      .deleteFrom("reviews")
      .where("reviews.product_id", "=", productId)
      .execute();

    await db
      .deleteFrom("comments")
      .where("comments.product_id", "=", productId)
      .execute();

    await db.deleteFrom("products").where("id", "=", productId).execute();

    await enableForeignKeyChecks();
    revalidatePath("/products");
    return { message: "success" };
  } catch (error) {
    return { error: "Something went wrong, Cannot delete the product" };
  }
}

export async function MapBrandIdsToName(brandsId) {
  const brandsMap = new Map();
  try {
    for (let i = 0; i < brandsId.length; i++) {
      const brandId = brandsId.at(i);
      const brand = await db
        .selectFrom("brands")
        .select("name")
        .where("id", "=", +brandId)
        .executeTakeFirst();
      brandsMap.set(brandId, brand?.name);
    }
    return brandsMap;
  } catch (error) {
    throw error;
  }
}

export async function getAllProductCategories(products: any) {
  try {
    const productsId = products.map((product) => product.id);
    const categoriesMap = new Map();

    for (let i = 0; i < productsId.length; i++) {
      const productId = productsId.at(i);
      const categories = await db
        .selectFrom("product_categories")
        .innerJoin(
          "categories",
          "categories.id",
          "product_categories.category_id"
        )
        .select("categories.name")
        .where("product_categories.product_id", "=", productId)
        .execute();
      categoriesMap.set(productId, categories);
    }
    return categoriesMap;
  } catch (error) {
    throw error;
  }
}

export async function getProductCategories(productId: number) {
  try {
    const categories = await db
      .selectFrom("product_categories")
      .innerJoin(
        "categories",
        "categories.id",
        "product_categories.category_id"
      )
      .select(["categories.id", "categories.name"])
      .where("product_categories.product_id", "=", productId)
      .execute();

    return categories;
  } catch (error) {
    throw error;
  }
}
