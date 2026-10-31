$ErrorActionPreference='Stop'
$cfg=[Console]::In.ReadToEnd() | ConvertFrom-Json
function New-VaultCertificate([string]$Name,[string[]]$Addresses){
  $rsa=[Security.Cryptography.RSA]::Create(2048)
  $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN='+$Name,$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
  $usage=[Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign
  $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage,$true))
  $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $san.AddDnsName($Name)
  foreach($address in $Addresses){$san.AddIpAddress([Net.IPAddress]::Parse($address))}
  $request.CertificateExtensions.Add($san.Build())
  $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),[DateTimeOffset]::UtcNow.AddYears(2))
  @{certificate=$cert.ExportCertificatePem();privateKey=$rsa.ExportPkcs8PrivateKeyPem();expires=$cert.NotAfter.ToUniversalTime().ToString('o')}
}
$prefix=$cfg.subnet -replace '\.0/24$',''
if($prefix -notmatch '^(192\.168\.\d+|10\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+)$'){throw 'HOME_SUBNET_REQUIRED'}
$addresses=@('127.0.0.1')+(1..254 | ForEach-Object {$prefix+'.'+$_})
@{pc=(New-VaultCertificate ($cfg.deviceId+'-pc') $addresses);phone=(New-VaultCertificate ($cfg.deviceId+'-phone') $addresses)} | ConvertTo-Json -Compress -Depth 5
