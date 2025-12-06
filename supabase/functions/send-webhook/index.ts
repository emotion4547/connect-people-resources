import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface WebhookPayload {
  id: string
  company: string
  position: string
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  address: string
  quantity: number
  requirements: string | null
  pay: string | null
  comments: string | null
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { request_id, test_mode } = await req.json()

    console.log(`Processing webhook for request_id: ${request_id}, test_mode: ${test_mode}`)

    // Get webhook settings
    const { data: settings, error: settingsError } = await supabase
      .from('webhook_settings')
      .select('*')
      .limit(1)
      .single()

    if (settingsError && settingsError.code !== 'PGRST116') {
      console.error('Error fetching webhook settings:', settingsError)
      throw new Error('Failed to fetch webhook settings')
    }

    if (!settings?.webhook_url || !settings?.is_active) {
      console.log('Webhook is not configured or inactive')
      return new Response(
        JSON.stringify({ success: false, message: 'Webhook не настроен или неактивен' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let payload: WebhookPayload

    if (test_mode) {
      // Send test payload
      payload = {
        id: 'test-' + Date.now(),
        company: 'Тестовая компания',
        position: 'Сортировщик',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        start_time: '09:00',
        end_time: '18:00',
        address: 'Москва, ул. Тестовая, 1',
        quantity: 5,
        requirements: 'Без опыта работы',
        pay: '3500 руб/смена',
        comments: 'Тестовая заявка'
      }
    } else {
      // Get request data
      const { data: request, error: requestError } = await supabase
        .from('requests')
        .select('*')
        .eq('id', request_id)
        .single()

      if (requestError || !request) {
        console.error('Error fetching request:', requestError)
        throw new Error('Request not found')
      }

      // Get HR profile for company name
      const { data: profile } = await supabase
        .from('profiles')
        .select('company')
        .eq('user_id', request.hr_id)
        .single()

      payload = {
        id: request.id,
        company: profile?.company || 'Неизвестная компания',
        position: request.position,
        start_date: request.start_date,
        end_date: request.end_date,
        start_time: request.start_time,
        end_time: request.end_time,
        address: request.address,
        quantity: request.quantity,
        requirements: request.requirements,
        pay: request.pay,
        comments: request.comments
      }
    }

    console.log('Sending webhook payload:', JSON.stringify(payload))

    // Send webhook with retry logic
    let success = false
    let responseText = ''
    let attempts = 0
    const maxAttempts = 3

    while (!success && attempts < maxAttempts) {
      attempts++
      console.log(`Webhook attempt ${attempts}/${maxAttempts}`)
      
      try {
        const response = await fetch(settings.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        responseText = await response.text()
        success = response.ok

        console.log(`Webhook response (attempt ${attempts}): status=${response.status}, body=${responseText}`)

        if (!success && attempts < maxAttempts) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
        }
      } catch (fetchError) {
        console.error(`Webhook fetch error (attempt ${attempts}):`, fetchError)
        responseText = fetchError instanceof Error ? fetchError.message : 'Unknown error'
        
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
        }
      }
    }

    // Log webhook attempt
    if (!test_mode && request_id) {
      const { error: logError } = await supabase
        .from('webhook_logs')
        .insert({
          request_id,
          url: settings.webhook_url,
          success,
          response: responseText.substring(0, 1000) // Limit response size
        })

      if (logError) {
        console.error('Error logging webhook:', logError)
      }

      // Update request webhook_sent status
      if (success) {
        await supabase
          .from('requests')
          .update({ webhook_sent: true })
          .eq('id', request_id)
      }
    }

    return new Response(
      JSON.stringify({ 
        success, 
        message: success ? 'Webhook отправлен успешно' : 'Ошибка отправки webhook',
        attempts,
        response: responseText.substring(0, 200)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Webhook function error:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
