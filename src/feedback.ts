import { z } from 'zod';
import { o1MiniModel } from './ai/providers';
import OpenAI from 'openai';

// Define the schema for our feedback questions
const FeedbackSchema = z.object({
  questions: z.array(z.string()),
});

interface FeedbackInput {
  query: string;
  numQuestions?: number;
}

export async function generateFeedback({ query, numQuestions = 3 }: FeedbackInput): Promise<string[]> {
  console.log('Generating feedback using OpenRouter...');
  try {
    // Cast the model to OpenAI type to access chat completions
    const openai = o1MiniModel as unknown as OpenAI;
    
    const completion = await openai.chat.completions.create({
      model: 'anthropic/claude-3-opus-20240229',
      messages: [
        {
          role: 'system',
          content: `You are a research assistant helping to understand what the user wants to research. 
            Generate ${numQuestions} follow up questions to better understand their research needs.
            Format your response as a JSON object with a "questions" array containing the questions.`,
        },
        {
          role: 'user',
          content: query,
        },
      ],
      response_format: { type: 'json_object' },
    });

    console.log('Raw response:', completion);
    // Parse the response as JSON
    const jsonResponse = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
    // Validate against our schema 
    const validated = FeedbackSchema.parse(jsonResponse);
    
    return validated.questions;
  } catch (error) {
    console.error('Error generating feedback:', error);
    throw error;
  }
}