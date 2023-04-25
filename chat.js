// @see https://docs.aircode.io/guide/functions/
const aircode = require('aircode');
const { Configuration, OpenAIApi } = require('openai');
const { v4: uuidv4 } = require('uuid');

const { db } = aircode;
const ChatTable = db.table('chat');

// Setup OpenAI configurations
const OPENAI_KEY = process.env.OPENAI_KEY || '';
// Use the latest OpenAI GPT-3.5 model, if the next 4 is released, modify this parameter
// OpenAI models parameter list https://platform.openai.com/docs/models
const OPENAI_MODEL = process.env.MODEL || 'gpt-3.5-turbo';
const MAX_MESSAGES_PER_CHAT = 40;

const systemContent = 'You are a helpful assistant.';

module.exports = async function (params, context) {
    console.log('Received params:', params);
    const { question, cid } = params;

    // Create a chat ID if not provided
    const chatId = cid ? cid : uuidv4();

    // Save user's question to the ChatTable
    await ChatTable.save({ chatId, role: 'user', content: question });

    // Retrieve chat history
    const chats = await ChatTable.where({ chatId })
        .sort({ createdAt: -1 })
        .limit(MAX_MESSAGES_PER_CHAT)
        .find();

    // Construct message array for ChatGPT
    const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...chats.reverse().map((one) => ({ role: one.role, content: one.content })),
    ];

    const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_KEY }));

    try {
        // Request completion from ChatGPT
        const completion = await openai.createChatCompletion({
            model: OPENAI_MODEL,
            messages,
            temperature: 1,
            n: 1,
            stream: false,
        });

        const responseMessage = completion.data.choices[0].message;

        // Save generated response to ChatTable
        await ChatTable.save({ chatId, ...responseMessage });

        // Return response message and chat ID
        return { reply: responseMessage.content, cid: chatId };
    } catch (error) {
        // Set the response status to 500 (Internal Server Error)
        context.status(500);
        // Log the error
        console.log('error', error.response || error);

        // Initialize an error message variable
        let errorMessage;

        // If there is a response object in the error,
        // it means the request was made and the server responded with an error status
        if (error.response) {
            const { status, statusText, data } = error.response;

            if (status === 401) {
                // If the status code is 401, set a specific error message related to the OpenAI API key
                errorMessage =
                    'Unauthorized: Invalid OpenAI API key, please check your API key in the AirCode Environments tab.';
            } else if (data.error && data.error.message) {
                // If there is an error message in the data, use it as the error message
                errorMessage = data.error.message;
            } else {
                // Otherwise, use the status code and status text as the error message
                errorMessage = `Request failed with status code ${status}: ${statusText}`;
            }
        } else if (error.request) {
            // If there is a request object in the error,
            // it means the request was made but no response was received
            errorMessage = 'No response received from the server';
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            // If there is a network error, such as DNS resolution or connection refused
            errorMessage = `Network error: ${error.message}`;
        } else {
            // If none of the above conditions are met,
            // it means there was an error setting up the request
            errorMessage = `Request setup error: ${error.message}`;
        }

        // Return an object containing the error message
        return { error: errorMessage };
    }
};
