async function requestDeepSeek({ apiKey, modelConfig, messages, temperature = 0.1, json = true }) {
  const requestBody = {
    model: modelConfig.id,
    messages,
    temperature,
    stream: false
  };

  if (json) requestBody.response_format = { type: 'json_object' };
  if (modelConfig.thinking === 'enabled' || modelConfig.thinking === 'disabled') {
    requestBody.thinking = { type: modelConfig.thinking };
  }

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(requestBody)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error('深度求索接口请求失败：' + raw.slice(0, 800));
  }

  const data = JSON.parse(raw);
  return {
    data,
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage || {}
  };
}

module.exports = {
  requestDeepSeek
};
