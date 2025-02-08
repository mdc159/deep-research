import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import OpenAI from 'openai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { o1MiniModel, trimPrompt } from './ai/providers';
import { systemPrompt } from './prompt';

// Define schemas
const QueriesSchema = z.object({
  queries: z.array(z.object({
    query: z.string(),
    researchGoal: z.string()
  }))
});

const ReportSchema = z.object({
  reportMarkdown: z.string()
});

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize Firecrawl with optional API key and optional base url
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
}) {
  console.log('Generating SERP queries...');
  try {
    const openai = o1MiniModel as unknown as OpenAI;
    
    const completion = await openai.chat.completions.create({
      model: 'anthropic/claude-3-opus-20240229',
      messages: [
        {
          role: 'system',
          content: `You are a research assistant helping to generate search queries. Format your response as a JSON object with a "queries" array containing objects with "query" and "researchGoal" properties.`
        },
        {
          role: 'user',
          content: `Generate ${numQueries} search queries to research this topic: ${query}${
            learnings ? `\nUse these previous learnings to generate more specific queries:\n${learnings.join('\n')}` : ''
          }`
        }
      ],
      response_format: { type: 'json_object' }
    });

    console.log('Raw response:', completion);
    console.log('Message content:', completion.choices[0]?.message?.content);
    
    try {
      const jsonResponse = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      console.log('Parsed JSON:', JSON.stringify(jsonResponse, null, 2));
      
      const validated = QueriesSchema.parse(jsonResponse);
      console.log('Validated response:', JSON.stringify(validated, null, 2));
      
      return validated.queries.slice(0, numQueries);
    } catch (parseError) {
      console.error('Error parsing response:', parseError);
      if (parseError instanceof SyntaxError) {
        console.error('JSON parsing error. Raw content:', completion.choices[0]?.message?.content);
      }
      throw parseError;
    }
  } catch (error) {
    console.error('Error generating SERP queries:', error);
    throw error;
  }
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}) {
  console.log('Processing SERP results...');
  try {
    const contents = compact(result.data.map(item => item.markdown)).map(
      content => trimPrompt(content, 25_000),
    );
    console.log(`Found ${contents.length} contents`);

    const openai = o1MiniModel as unknown as OpenAI;
    
    const completion = await openai.chat.completions.create({
      model: 'anthropic/claude-3-opus-20240229',
      messages: [
        {
          role: 'system',
          content: `You are a research assistant that ONLY responds with valid JSON objects. Never include any explanatory text before or after the JSON. Your response must be parseable by JSON.parse().

Format your response as a JSON object with "learnings" and "followUpQuestions" arrays.`
        },
        {
          role: 'user',
          content: `Analyze these search results and return ONLY a JSON object containing ${numLearnings} key learnings and ${numFollowUpQuestions} follow-up questions about: "${query}"\n\n${contents.map(content => `<content>\n${content}\n</content>`).join('\n')}`
        }
      ],
      response_format: { type: 'json_object' }
    });

    console.log('Raw response:', completion);
    
    if (!completion.choices?.[0]?.message?.content) {
      console.error('Invalid response format from OpenRouter:', completion);
      return {
        learnings: [],
        followUpQuestions: []
      };
    }

    try {
      const jsonResponse = JSON.parse(completion.choices[0].message.content);
      console.log('Parsed JSON:', JSON.stringify(jsonResponse, null, 2));
      
      const validated = z.object({
        learnings: z.array(z.string()),
        followUpQuestions: z.array(z.string())
      }).parse(jsonResponse);
      
      console.log('Validated response:', JSON.stringify(validated, null, 2));
      return validated;
    } catch (parseError) {
      console.error('Error parsing response:', parseError);
      if (parseError instanceof SyntaxError) {
        console.error('JSON parsing error. Raw content:', completion.choices[0].message.content);
      }
      return {
        learnings: [],
        followUpQuestions: []
      };
    }
  } catch (error) {
    console.error('Error processing SERP results:', error);
    return {
      learnings: [],
      followUpQuestions: []
    };
  }
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}) {
  console.log('Generating final report...');
  try {
    const learningsString = trimPrompt(
      learnings
        .map(learning => `<learning>\n${learning}\n</learning>`)
        .join('\n'),
      150_000,
    );

    const openai = o1MiniModel as unknown as OpenAI;
    
    const completion = await openai.chat.completions.create({
      model: 'anthropic/claude-3-opus-20240229',
      messages: [
        {
          role: 'system',
          content: `You are a research assistant that ONLY responds with valid JSON objects. Never include any explanatory text before or after the JSON. Your response must be parseable by JSON.parse().

Format your response as a JSON object with a "reportMarkdown" property containing the markdown-formatted report.`
        },
        {
          role: 'user',
          content: `Write a detailed report (3+ pages) and return it as a JSON object with a single "reportMarkdown" property containing the markdown text.

Topic: ${prompt}

Research findings:
${learningsString}`
        }
      ],
      response_format: { type: 'json_object' }
    });

    console.log('Raw response:', completion);
    
    if (!completion.choices?.[0]?.message?.content) {
      console.error('Invalid response format from OpenRouter:', completion);
      return '';
    }

    try {
      const jsonResponse = JSON.parse(completion.choices[0].message.content);
      console.log('Parsed JSON:', JSON.stringify(jsonResponse, null, 2));
      
      const validated = ReportSchema.parse(jsonResponse);
      console.log('Validated response:', JSON.stringify(validated, null, 2));
      
      const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
      return validated.reportMarkdown + urlsSection;
    } catch (parseError) {
      console.error('Error parsing response:', parseError);
      if (parseError instanceof SyntaxError) {
        console.error('JSON parsing error. Raw content:', completion.choices[0].message.content);
      }
      return '';
    }
  } catch (error) {
    console.error('Error generating final report:', error);
    return '';
  }
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
}): Promise<ResearchResult> {
  try {
    console.log('Generating SERP queries...');
    const serpQueries = await generateSerpQueries({
      query,
      numQueries: breadth,
      learnings,
    });
    
    const limit = pLimit(ConcurrencyLimit);
    console.log('Processing queries:', serpQueries);

    const results = await Promise.all(
      serpQueries.map(serpQuery =>
        limit(async () => {
          try {
            console.log('Searching for:', serpQuery.query);
            const result = await firecrawl.search(serpQuery.query, {
              timeout: 15000,
              limit: 5,
              scrapeOptions: { formats: ['markdown'] },
            });

            // Collect URLs from this search
            const newUrls = compact(result.data.map(item => item.url));
            const newBreadth = Math.ceil(breadth / 2);
            const newDepth = depth - 1;

            console.log('Processing search results...');
            const processedResults = await processSerpResult({
              query: serpQuery.query,
              result,
              numLearnings: 3,
              numFollowUpQuestions: newBreadth,
            });

            const allLearnings = [...learnings, ...processedResults.learnings];
            const allUrls = [...visitedUrls, ...newUrls];

            if (newDepth > 0) {
              console.log(
                `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
              );

              const nextQuery = `
                Previous research goal: ${serpQuery.researchGoal}
                Follow-up questions: ${processedResults.followUpQuestions.join('\n')}
              `.trim();

              return deepResearch({
                query: nextQuery,
                breadth: newBreadth,
                depth: newDepth,
                learnings: allLearnings,
                visitedUrls: allUrls,
              });
            } else {
              return {
                learnings: allLearnings,
                visitedUrls: allUrls,
              };
            }
          } catch (error) {
            console.error(`Error processing query "${serpQuery.query}":`, error);
            return {
              learnings: [],
              visitedUrls: [],
            };
          }
        }),
      ),
    );

    // Combine all results
    return {
      learnings: [...new Set(results.flatMap(r => r.learnings))],
      visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
    };
  } catch (error) {
    console.error('Error in deep research:', error);
    throw error;
  }
}