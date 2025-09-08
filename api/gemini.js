
// This file is your secure backend proxy.
// It needs to be deployed as a "serverless function" on a hosting provider like Vercel or Netlify.
//
// HOW TO DEPLOY:
// 1. Create a new project on Vercel (or a similar platform).
// 2. Place this `gemini.js` file inside an `api` directory in your project root.
// 3. Place your `index.html` file in the project root.
// 4. In your Vercel project settings, go to "Environment Variables".
// 5. Add a new environment variable named `API_KEY` and paste your secret Gemini API key as the value.
// 6. Deploy the project. Vercel will automatically detect the `api` directory and set up this function.
// 7. Your `index.html` will now be able to make secure requests to this backend.

import { GoogleGenAI, Type, Modality } from "@google/genai";

// This is the main handler for the serverless function.
// It uses a generic signature compatible with Vercel, Netlify, etc.
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Initialize the AI client securely on the server using the environment variable.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const { task, params } = req.body;
        let result;

        // Use a switch to handle different tasks requested by the frontend.
        switch (task) {
            case 'generateImage':
                result = await handleGenerateImage(ai, params);
                break;
            case 'removeBackground':
                result = await handleRemoveBackground(ai, params);
                break;
            case 'applyDesign':
                result = await handleApplyDesign(ai, params);
                break;
            case 'generateSeo':
                result = await handleGenerateSeo(ai, params);
                break;
            case 'generateAltText':
                result = await handleGenerateAltText(ai, params);
                break;
            default:
                return res.status(400).json({ error: 'Invalid task specified' });
        }
        
        return res.status(200).json(result);

    } catch (error) {
        console.error(`Error in task:`, error);
        return res.status(500).json({ error: error.message || 'An internal server error occurred' });
    }
}


// --- Task Handlers ---

async function handleGenerateImage(ai, { prompt, numberOfImages }) {
    const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: numberOfImages,
          outputMimeType: 'image/png',
          aspectRatio: '1:1',
        },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
        return { images: response.generatedImages.map(img => img.image.imageBytes) };
    }
    throw new Error("Image generation failed to produce any images.");
}

async function handleRemoveBackground(ai, { mimeType, data }) {
    const designPart = { inlineData: { mimeType, data } };
    const textPart = { text: 'Remove the background from this image, leaving only the main subject. The background should be transparent, resulting in a PNG with an alpha channel.' };
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [designPart, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
        throw new Error("Background removal failed. The AI did not return an image, which might be due to a safety filter.");
    }

    for (const part of candidate.content.parts) {
        if (part.inlineData) {
            return { image: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
        }
    }
    throw new Error("Background removal failed to produce an image.");
}

async function handleApplyDesign(ai, { blankMockupBase64, designMimeType, designBase64, productName }) {
    const blankMockupPart = { inlineData: { mimeType: 'image/png', data: blankMockupBase64 } };
    const designPart = { inlineData: { mimeType: designMimeType, data: designBase64 } };
    const textPart = { text: `Apply the second image (the artwork) onto the ${productName} in the first image (the mockup). The artwork should be placed naturally on the product, following its contours, shadows, and texture for a photorealistic result. Make sure the applied design is clearly visible and well-integrated.` };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [blankMockupPart, designPart, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    
    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
        throw new Error("Applying the design failed. The AI did not return an image, which might be due to a safety filter.");
    }

    for (const part of candidate.content.parts) {
        if (part.inlineData) {
            return { image: part.inlineData.data };
        }
    }
    throw new Error("Image editing failed to produce an image.");
}

async function handleGenerateSeo(ai, { productName, designDescription }) {
    const seoSchema = {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: `A catchy, SEO-friendly product title for a ${productName}. The title must be under 80 characters.`,
            },
            description: {
                type: Type.STRING,
                description: `A detailed and compelling product description between 200 and 300 words. It should highlight the product's benefits and appeal to potential customers, written in a friendly, persuasive tone.`,
            },
            features: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: `A bulleted list of 3 to 5 key features of the ${productName}.`,
            },
            tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: `A list of 10 to 15 relevant SEO tags or keywords that a user might search for to find this ${productName}.`,
            }
        },
        required: ["title", "description", "features", "tags"],
    };

    // The prompt is now simpler, with detailed instructions moved to the schema descriptions for better reliability.
    const prompt = `Generate an SEO-optimized product listing for a ${productName} with a design described as: ${designDescription}.`;
    
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: seoSchema }
    });
    
    try {
        // The Gemini API should return a string that is valid JSON. This is a safeguard.
        const content = JSON.parse(response.text);
        return { content };
    } catch (e) {
        console.error("Failed to parse JSON response from Gemini:", response.text);
        throw new Error("The AI returned data in an unexpected format. Please try generating the SEO listing again.");
    }
}

async function handleGenerateAltText(ai, { mimeType, data }) {
    const imagePart = { inlineData: { mimeType, data } };
    const promptPart = { text: 'Generate a concise, ADA-compliant alt text for this image. Describe the product, the design on it, and the overall style of the mockup photo.' };
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, promptPart] }
    });

    return { text: response.text.trim() };
}
