const { GoogleGenerativeAI } = require("@google/generative-ai");

// User's provided key
const apiKey = "AIzaSyBUj67-zVKSFFRJIGlMQJcYmhIYArF9rPE";
const genAI = new GoogleGenerativeAI(apiKey);

async function run() {
    console.log("--- Testing gemini-2.5-flash ---");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent("Hello?");
        console.log("Success with gemini-2.5-flash! Response:", result.response.text());
    } catch (e) {
        // console.error("Failed with gemini-2.5-flash:", e.message);
        // Print full error for debugging
        console.error("Failed with gemini-2.5-flash:", JSON.stringify(e, null, 2));
        if (e.message) console.error("Error Message:", e.message);
    }

    console.log("\n--- Testing gemini-2.0-flash-001 ---");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-001" });
        const result = await model.generateContent("Hello?");
        console.log("Success with gemini-2.0-flash-001! Response:", result.response.text());
    } catch (e) {
        console.error("Failed with gemini-2.0-flash-001:", e.message);
    }
}

run();
