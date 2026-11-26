import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {propertyWhatsAppJs} from '../src/property-whatsapp-ui.mjs';
import {js} from '../src/app-assets.mjs';

function context(){
 const scope={URL,Date,location:{origin:'https://calling.example.invalid'},node:(tag,props={})=>({tag,...props})};
 vm.createContext(scope);vm.runInContext(propertyWhatsAppJs,scope);return scope;
}
test('scheduled India wall time is independent of the browser local timezone',()=>{
 const c=context();
 assert.equal(c.pwIstIso('2026-11-26T18:30'),'2026-11-26T13:00:00.000Z');
 assert.equal(c.pwIstValue('2026-11-26T13:00:00.000Z'),'2026-11-26T18:30');
 assert.throws(()=>c.pwIstIso('not-a-time'),/valid date/);
 assert.throws(()=>c.pwIstIso(''),/valid date/);
});
test('property links reject executable schemes and embedded URL credentials',()=>{
 const c=context();
 for(const url of ['javascript:alert(1)','data:text/html,hello','file:///etc/passwd','https://name:password@example.invalid/'])assert.equal(c.pwLink(url,'Brochure').tag,'span');
 assert.equal(c.pwLink('https://maps.example.invalid/plot','Map').rel,'noopener noreferrer');
 assert.equal(c.pwLink('/v1/human/property-assets?tenantId=a&assetId=b','Brochure').href,'https://calling.example.invalid/v1/human/property-assets?tenantId=a&assetId=b');
});
test('submitted and unknown WhatsApp outcomes never display as delivered',()=>{
 const c=context();
 assert.equal(c.pwStatus('submitted').text,'Submitted to WhatsApp');
 assert.equal(c.pwStatus('unknown').text,'Delivery not confirmed');
 assert.equal(c.pwStatus('delivered').text,'Delivered');
 assert.equal(c.pwStatus('submitted').class.includes('positive'),false);
});
test('new UI composes into the existing browser bundle without syntax errors',()=>{
 assert.doesNotThrow(()=>new vm.Script(js));
});
