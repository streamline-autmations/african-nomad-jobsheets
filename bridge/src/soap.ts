import { XMLParser } from "fast-xml-parser";
import { escapeXml } from "./qbxml/xml";
import type { SessionManager } from "./session";

const QBWC_NS = "http://developer.intuit.com/";

const soapParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  removeNSPrefix: true,
});

/** Extract the invoked method element and its string parameters from a SOAP body. */
export interface SoapCall {
  method: string;
  params: Record<string, string>;
}

export function parseSoapCall(body: string): SoapCall {
  const doc = soapParser.parse(body);
  const envelope = doc?.Envelope;
  const soapBody = envelope?.Body;
  if (!soapBody || typeof soapBody !== "object") {
    throw new Error("SOAP body missing");
  }

  const method = Object.keys(soapBody)[0];
  if (!method) throw new Error("No method element in SOAP body");

  const inner = soapBody[method];
  const params: Record<string, string> = {};
  if (inner && typeof inner === "object") {
    for (const [key, value] of Object.entries(inner)) {
      params[key] = value == null ? "" : String(value);
    }
  }

  return { method, params };
}

function soapEnvelope(inner: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<soap:Body>${inner}</soap:Body></soap:Envelope>`
  );
}

function stringResult(method: string, value: string): string {
  return soapEnvelope(
    `<${method}Response xmlns="${QBWC_NS}">` +
      `<${method}Result>${escapeXml(value)}</${method}Result>` +
      `</${method}Response>`,
  );
}

function intResult(method: string, value: number): string {
  return soapEnvelope(
    `<${method}Response xmlns="${QBWC_NS}">` +
      `<${method}Result>${value}</${method}Result>` +
      `</${method}Response>`,
  );
}

function stringArrayResult(method: string, values: string[]): string {
  const items = values.map((v) => `<string>${escapeXml(v)}</string>`).join("");
  return soapEnvelope(
    `<${method}Response xmlns="${QBWC_NS}">` +
      `<${method}Result>${items}</${method}Result>` +
      `</${method}Response>`,
  );
}

/** Dispatch one SOAP call to the session manager and return the response envelope XML. */
export async function handleSoapCall(
  manager: SessionManager,
  body: string,
): Promise<string> {
  const { method, params } = parseSoapCall(body);

  switch (method) {
    case "serverVersion":
      return stringResult("serverVersion", manager.serverVersion());

    case "clientVersion":
      return stringResult("clientVersion", manager.clientVersion());

    case "authenticate": {
      const [ticket, indicator] = await manager.authenticate(
        params.strUserName ?? "",
        params.strPassword ?? "",
      );
      return stringArrayResult("authenticate", [ticket, indicator]);
    }

    case "sendRequestXML":
      return stringResult("sendRequestXML", manager.sendRequestXML(params.ticket ?? ""));

    case "receiveResponseXML": {
      const pct = await manager.receiveResponseXML(params.ticket ?? "", params.response ?? "");
      return intResult("receiveResponseXML", pct);
    }

    case "connectionError":
      return stringResult(
        "connectionError",
        manager.connectionError(params.ticket ?? "", params.message ?? ""),
      );

    case "getLastError":
      return stringResult("getLastError", manager.getLastError(params.ticket ?? ""));

    case "closeConnection":
      return stringResult("closeConnection", manager.closeConnection(params.ticket ?? ""));

    default:
      throw new Error(`Unknown QBWC method: ${method}`);
  }
}

/** WSDL served at GET /?wsdl — this is the contract Web Connector reads on connect. */
export function buildWsdl(endpointUrl: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:tns="${QBWC_NS}"
  xmlns:s="http://www.w3.org/2001/XMLSchema"
  targetNamespace="${QBWC_NS}" name="QBWebConnectorSvc">
  <wsdl:types>
    <s:schema elementFormDefault="qualified" targetNamespace="${QBWC_NS}">
      <s:element name="serverVersion"><s:complexType/></s:element>
      <s:element name="serverVersionResponse"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="serverVersionResult" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="clientVersion"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="strVersion" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="clientVersionResponse"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="clientVersionResult" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="authenticate"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="strUserName" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="strPassword" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="authenticateResponse"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="authenticateResult" type="tns:ArrayOfString"/>
      </s:sequence></s:complexType></s:element>
      <s:complexType name="ArrayOfString"><s:sequence>
        <s:element minOccurs="0" maxOccurs="unbounded" name="string" nillable="true" type="s:string"/>
      </s:sequence></s:complexType>
      <s:element name="sendRequestXML"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="ticket" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="strHCPResponse" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="strCompanyFileName" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="qbXMLCountry" type="s:string"/>
        <s:element minOccurs="1" maxOccurs="1" name="qbXMLMajorVers" type="s:int"/>
        <s:element minOccurs="1" maxOccurs="1" name="qbXMLMinorVers" type="s:int"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="sendRequestXMLResponse"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="sendRequestXMLResult" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="receiveResponseXML"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="ticket" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="response" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="hresult" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="message" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="receiveResponseXMLResponse"><s:complexType><s:sequence>
        <s:element minOccurs="1" maxOccurs="1" name="receiveResponseXMLResult" type="s:int"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="connectionError"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="ticket" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="hresult" type="s:string"/>
        <s:element minOccurs="0" maxOccurs="1" name="message" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="connectionErrorResponse"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="connectionErrorResult" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="getLastError"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="ticket" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="getLastErrorResponse"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="getLastErrorResult" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="closeConnection"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="ticket" type="s:string"/>
      </s:sequence></s:complexType></s:element>
      <s:element name="closeConnectionResponse"><s:complexType><s:sequence>
        <s:element minOccurs="0" maxOccurs="1" name="closeConnectionResult" type="s:string"/>
      </s:sequence></s:complexType></s:element>
    </s:schema>
  </wsdl:types>
  <wsdl:message name="serverVersionSoapIn"><wsdl:part name="parameters" element="tns:serverVersion"/></wsdl:message>
  <wsdl:message name="serverVersionSoapOut"><wsdl:part name="parameters" element="tns:serverVersionResponse"/></wsdl:message>
  <wsdl:message name="clientVersionSoapIn"><wsdl:part name="parameters" element="tns:clientVersion"/></wsdl:message>
  <wsdl:message name="clientVersionSoapOut"><wsdl:part name="parameters" element="tns:clientVersionResponse"/></wsdl:message>
  <wsdl:message name="authenticateSoapIn"><wsdl:part name="parameters" element="tns:authenticate"/></wsdl:message>
  <wsdl:message name="authenticateSoapOut"><wsdl:part name="parameters" element="tns:authenticateResponse"/></wsdl:message>
  <wsdl:message name="sendRequestXMLSoapIn"><wsdl:part name="parameters" element="tns:sendRequestXML"/></wsdl:message>
  <wsdl:message name="sendRequestXMLSoapOut"><wsdl:part name="parameters" element="tns:sendRequestXMLResponse"/></wsdl:message>
  <wsdl:message name="receiveResponseXMLSoapIn"><wsdl:part name="parameters" element="tns:receiveResponseXML"/></wsdl:message>
  <wsdl:message name="receiveResponseXMLSoapOut"><wsdl:part name="parameters" element="tns:receiveResponseXMLResponse"/></wsdl:message>
  <wsdl:message name="connectionErrorSoapIn"><wsdl:part name="parameters" element="tns:connectionError"/></wsdl:message>
  <wsdl:message name="connectionErrorSoapOut"><wsdl:part name="parameters" element="tns:connectionErrorResponse"/></wsdl:message>
  <wsdl:message name="getLastErrorSoapIn"><wsdl:part name="parameters" element="tns:getLastError"/></wsdl:message>
  <wsdl:message name="getLastErrorSoapOut"><wsdl:part name="parameters" element="tns:getLastErrorResponse"/></wsdl:message>
  <wsdl:message name="closeConnectionSoapIn"><wsdl:part name="parameters" element="tns:closeConnection"/></wsdl:message>
  <wsdl:message name="closeConnectionSoapOut"><wsdl:part name="parameters" element="tns:closeConnectionResponse"/></wsdl:message>
  <wsdl:portType name="QBWebConnectorSvcSoap">
    <wsdl:operation name="serverVersion"><wsdl:input message="tns:serverVersionSoapIn"/><wsdl:output message="tns:serverVersionSoapOut"/></wsdl:operation>
    <wsdl:operation name="clientVersion"><wsdl:input message="tns:clientVersionSoapIn"/><wsdl:output message="tns:clientVersionSoapOut"/></wsdl:operation>
    <wsdl:operation name="authenticate"><wsdl:input message="tns:authenticateSoapIn"/><wsdl:output message="tns:authenticateSoapOut"/></wsdl:operation>
    <wsdl:operation name="sendRequestXML"><wsdl:input message="tns:sendRequestXMLSoapIn"/><wsdl:output message="tns:sendRequestXMLSoapOut"/></wsdl:operation>
    <wsdl:operation name="receiveResponseXML"><wsdl:input message="tns:receiveResponseXMLSoapIn"/><wsdl:output message="tns:receiveResponseXMLSoapOut"/></wsdl:operation>
    <wsdl:operation name="connectionError"><wsdl:input message="tns:connectionErrorSoapIn"/><wsdl:output message="tns:connectionErrorSoapOut"/></wsdl:operation>
    <wsdl:operation name="getLastError"><wsdl:input message="tns:getLastErrorSoapIn"/><wsdl:output message="tns:getLastErrorSoapOut"/></wsdl:operation>
    <wsdl:operation name="closeConnection"><wsdl:input message="tns:closeConnectionSoapIn"/><wsdl:output message="tns:closeConnectionSoapOut"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="QBWebConnectorSvcSoap" type="tns:QBWebConnectorSvcSoap">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    ${[
      "serverVersion",
      "clientVersion",
      "authenticate",
      "sendRequestXML",
      "receiveResponseXML",
      "connectionError",
      "getLastError",
      "closeConnection",
    ]
      .map(
        (op) =>
          `<wsdl:operation name="${op}"><soap:operation soapAction="${QBWC_NS}${op}" style="document"/>` +
          `<wsdl:input><soap:body use="literal"/></wsdl:input>` +
          `<wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>`,
      )
      .join("\n    ")}
  </wsdl:binding>
  <wsdl:service name="QBWebConnectorSvc">
    <wsdl:port name="QBWebConnectorSvcSoap" binding="tns:QBWebConnectorSvcSoap">
      <soap:address location="${escapeXml(endpointUrl)}"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
}
