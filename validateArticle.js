const { z } = require('zod');

const FaqItemSchema = z.object({
  question: z.string().min(5, 'FAQ question too short'),
  answer: z.string().min(10, 'FAQ answer too short'),
});

const SchemaJsonLdSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.literal('FAQPage'),
  mainEntity: z.array(z.any()).min(3, 'schema_jsonld mainEntity must have at least 3 items'),
});

// Generic article schema — works for comparison articles, blog posts,
// landing pages, thought leadership, glossary pages, and more.
// Required fields are the minimal set needed for export and publishing.
const ArticleSchema = z.object({
  article_title: z.string().min(1, 'article_title is required'),
  article_slug: z
    .string()
    .min(1, 'article_slug is required')
    .regex(/^[a-z0-9-]+$/, 'article_slug must be lowercase kebab-case'),
  meta_title: z.string().min(1).max(70, 'meta_title must be 70 chars or fewer'),
  meta_description: z.string().min(50).max(165, 'meta_description must be 50–165 chars'),
  excerpt: z.string().min(30, 'excerpt must be at least 30 chars'),
  article_body_markdown: z.string().min(500, 'article_body_markdown must be at least 500 chars'),
  faq_json: z.array(FaqItemSchema).min(1, 'faq_json must contain at least 1 FAQ item').optional(),
  schema_jsonld: SchemaJsonLdSchema.optional(),
  canonical_url: z.string().min(1, 'canonical_url is required'),
  internal_links: z.array(z.string()).optional().default([]),
  quality_score: z.number().int().min(1).max(10),
  claude_prompt_version: z.string().default('v1'),
  generated_at: z.string().min(1, 'generated_at is required'),
  rewrite_triggered: z.boolean().optional(),
  article_type: z.string().optional(),
});

function validateArticle(obj) {
  const result = ArticleSchema.safeParse(obj);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`
  );
  return { success: false, errors };
}

module.exports = { validateArticle, ArticleSchema };
