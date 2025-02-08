import { o1MiniModel } from './ai/providers';
import { generateFeedback } from './feedback';

async function testOpenRouter() {
  console.log('Testing OpenRouter Integration...');
  console.log('Using API Key:', process.env.OPENROUTER_API_KEY?.slice(0, 10) + '...');
  
  try {
    const result = await generateFeedback({
      query: 'Tell me about quantum computing',
      numQuestions: 2
    });
    
    console.log('Success! Generated questions:', result);
  } catch (error: unknown) {
    console.error('Failed to generate feedback:', error);
    if (error && typeof error === 'object' && 'response' in error) {
      console.error('API Response:', (error as any).response.data);
    }
    process.exit(1);
  }
}

console.log('Starting test...');
testOpenRouter().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});