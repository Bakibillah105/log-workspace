(function(scope) {
  'use strict';
  const local = key => key.replace(/^.*:/, '');
  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !/^@xmlns/.test(k)).map(([k,v]) => [local(k), normalize(v)]));
  }
  function find(value, key) {
    if (!value || typeof value !== 'object') return null;
    for (const [k,v] of Object.entries(value)) {
      if (k.toLowerCase() === key.toLowerCase()) return v;
      const nested = find(v,key); if (nested !== null) return nested;
    }
    return null;
  }
  function callback(text) {
    const match = text.match(/(?:^|\n)\s*([\w.-]*CALLBACK)\s*:\s*\r?\n\s*([^\r\n]+)/i);
    if (!match) return null;
    const values = match[2].split('|').map(v=>v.trim());
    if (values.length !== 5) return null;
    return {start:match.index, end:match.index+match[0].length, source:match[1], data:{'Trans ID':values[0], 'Client Txn ID':values[1], 'Result Code':values[2], 'Error Code':values[3], 'Error Message':values[4]}, error:!!values[3] && !/^(?:0|none|null|success)$/i.test(values[3])};
  }
  function request(value) {
    const data = normalize(value);
    const req = find(data, 'Request');
    if (!req?.Header || !req?.Body || !req.Header.CommandID) return null;
    const h=req.Header, b=req.Body, caller=h.Caller || {}, identity=b.Identity || {};
    const rows = pairs => pairs.filter(([,v])=>v !== undefined);
    const header=rows([['Command',h.CommandID],['Conversation ID',h.OriginatorConversationID],['Caller (3rd Party)',caller.ThirdPartyID],['Channel Code',h.ChannelCode],['Timestamp (raw)',h.Timestamp]]);
    const identities=Object.entries(identity).map(([role,v])=> [role==='ReceiverParty'?'Receiver':role, v?.Identifier ?? '', [v?.ShortCode !== undefined ? 'Short code: '+v.ShortCode : '',v?.IdentifierType !== undefined ? 'Identifier type: '+v.IdentifierType : ''].filter(Boolean).join(' · ')]);
    const parameters=b.TransactionRequest?.Parameters || {};
    let references=b.ReferenceData?.ReferenceItem || []; if (!Array.isArray(references)) references=[references];
    const refs=references.filter(x=>x && x.Key !== undefined).map(x=>[String(x.Key),x.Value ?? '']);
    const ref=k=>refs.find(([key])=>key.toLowerCase()===k.toLowerCase())?.[1];
    const money=(amount,currency)=>amount===undefined?undefined:String(amount)+(currency?' '+currency:'');
    const transaction=rows([['Amount',money(parameters.Amount,parameters.Currency)],['Original Txn Amount',money(ref('Original Transaction Amount'),ref('Originating Currency'))],['Exchange Rate',ref('Exchange Rate')],['Govt. Incentive',ref('Govt. incentive')]]);
    const moved=/^(Original Transaction Amount|Originating Currency|Exchange Rate|Govt\. incentive)$/i;
    const reference=refs.filter(([k])=>!moved.test(k)); if (b.Remark !== undefined) reference.push(['Remark',b.Remark]);
    // Retain fields outside the concise tables rather than silently discarding them.
    const extra=normalize(req);
    for(const key of ['CommandID','OriginatorConversationID','ChannelCode','Timestamp']) delete extra.Header[key];
    if(extra.Header.Caller) delete extra.Header.Caller.ThirdPartyID;
    for(const v of Object.values(extra.Body.Identity || {})) if(v && typeof v==='object') for(const key of ['Identifier','IdentifierType','ShortCode']) delete v[key];
    if(extra.Body.TransactionRequest?.Parameters) for(const key of ['Amount','Currency']) delete extra.Body.TransactionRequest.Parameters[key];
    const remainingRefs=extra.Body.ReferenceData?.ReferenceItem;
    for (const item of (Array.isArray(remainingRefs)?remainingRefs:[remainingRefs])) if(item && item.Key !== undefined) { delete item.Key; delete item.Value; }
    delete extra.Body.Remark;
    function prune(v) { if(!v || typeof v!=='object') return v; const present=x=>!(x && typeof x==='object' && !Object.keys(x).length); if(Array.isArray(v)) return v.map(prune).filter(present); return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,prune(x)]).filter(([,x])=>present(x))); }
    return {title:'Request — '+String(h.CommandID).replace(/_/g,' — '), groups:[{title:'Header',columns:['Field','Value'],rows:header},{title:'Identity',columns:['Role','Identifier','Notes'],rows:identities},{title:'Transaction',columns:['Field','Value'],rows:transaction},{title:'Reference Data',columns:['Key','Value'],rows:reference}].filter(g=>g.rows.length), extra:prune(extra)};
  }
  scope.ReportModel={normalize,find,callback,request};
  if(typeof module!=='undefined') module.exports=scope.ReportModel;
})(typeof window==='undefined'?globalThis:window);
