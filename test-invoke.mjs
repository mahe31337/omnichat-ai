import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8').split('\n').reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val.length) acc[key.trim()] = val.join('=').trim().split(' ')[0]; // Basic parse
    return acc;
}, {});

const client = new BedrockAgentRuntimeClient({
    region: env.VITE_AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: env.VITE_AWS_ACCESS_KEY_ID,
        secretAccessKey: env.VITE_AWS_SECRET_ACCESS_KEY,
    }
});

async function main() {
    const command = new InvokeAgentCommand({
        agentId: env.VITE_BEDROCK_AGENT_ID,
        agentAliasId: env.VITE_BEDROCK_AGENT_ALIAS_ID,
        sessionId: "sess-test-" + Date.now(),
        inputText: "create terraform scrip and keep the placeholder for ai values, i will fill it later"
    });
    
    try {
        const response = await client.send(command);
        let completion = "";
        for await (const chunkEvent of response.completion) {
            console.log(JSON.stringify(Object.keys(chunkEvent)));
            if (chunkEvent.chunk && chunkEvent.chunk.bytes) {
                const text = new TextDecoder("utf-8").decode(chunkEvent.chunk.bytes);
                completion += text;
            } else if (chunkEvent.trace) {
               console.log("TRACE IS PRESENT");
            }
        }
        console.log("Final:", completion);
    } catch (e) {
        console.error(e);
    }
}
main();
